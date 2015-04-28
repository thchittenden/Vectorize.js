vectorize = (function() {
  
    var esprima = require('esprima');
    var escodegen = require('escodegen');
    var estraverse = require('estraverse');
    var esrecurse = require('esrecurse');
    var _ = require('underscore');

    function unsupported(node) {
        throw ("unsupported operation: " + escodegen.generate(node));
    }
    function assert(cond) {
        if (!cond) throw "assertion failed";
    }
    function trace(str) {
        console.log(str);
    }
   
    // SIMD properties.
    var vectorWidth = 4;
    var vectorAccessors = ['x', 'y', 'z', 'w'];
    var vectorConstructor = util.property(util.ident('SIMD'), 'float32x4'); 
    var vectorOp = {};
    vectorOp['+'] = util.property(vectorConstructor, 'add');
    vectorOp['-'] = util.property(vectorConstructor, 'sub');
    vectorOp['*'] = util.property(vectorConstructor, 'mul');
    vectorOp['/'] = util.property(vectorConstructor, 'div');
    vectorOp['<'] = util.property(vectorConstructor, 'lessThan');
    vectorOp['<='] = util.property(vectorConstructor, 'lessThanOrEqual');
    vectorOp['=='] = util.property(vectorConstructor, 'equal');
    vectorOp['!='] = util.property(vectorConstructor, 'notEqual');
    vectorOp['>='] = util.property(vectorConstructor, 'greaterThanOrEqual');
    vectorOp['>'] = util.property(vectorConstructor, 'greaterThan');
    var tempIdx = 0; // Yikes!

    function splat(val) {
        return util.call(util.property(vectorConstructor, 'splat'), [val]);
    }

    function nodekey(node) {
        var id = node.type + '_' + escodegen.generate(node);
        return id.replace(/[-\+\*\/\.\[\]]/g, '_');
    }

    // Creates a unique key for an array and its linear index. Given something
    // like (obj.arr[a*i + b]) we'll get a string: 'obj_arr_a_i_b'.
    function vectorkey(arr, idxfactors) {
        
        // Create a string for the array.
        var id = nodekey(arr) + '_';

        // Append keys for the factors.
        for (var elem in idxfactors.factors) {
            id += idxfactors.factors[elem] + "_" + elem + "_";
        }
        id += idxfactors.constant;

        return id;
    }
    function mktemp(node) {
        var id = nodekey(node);
        return 'temp' + tempIdx++ + '_' + id;
    }

    // Converts a function to a function expression so we can manipulate 
    // it like an object.
    function makeFunctionExpression(ast) {
        if (ast.body[0].type === "FunctionDeclaration") {
            var fn = ast.body[0];
            fn.type = "FunctionExpression";
            fn.id = null;
            ast.body[0] = { type: "ExpressionStatement", expression: fn };
        } 
        return ast;
    }

    // Steps the index inside an expression to a particular iteration.
    function stepIndex(expr, iv, iter) {
        esrecurse.visit(expr, {
            Identifier: function (node) {
                if (node.name === iv.name) {
                    util.set(node, iv.step(iter));
                }
            }
        });
        return util.canonExpression(expr);
    }
    
    // Constructs a vector by replacing the IV in the expression with 
    // vectorWidth successive steps.
    //      vecIndex("2*i", iv) 
    // becomes
    //      v(2*i, 2*(i+1), 2*(i+2), 2*(i+3));
    function vecIndex(iv_expr, iv) {
        var args = [];
        for (var i = 0; i < vectorWidth; i++) {
            var expr = util.clone(iv_expr);
            args[i] = stepIndex(expr, iv, i);
        }
        return util.call(vectorConstructor, args);
    }

    // Creates a statement that reads four elements from the array 'arrName' 
    // into the vector 'vecName'.
    function vecReadIndex(vecName, arrIdx, iv) {
        return util.declassignment(util.ident(vecName), vecIndex(arrIdx, iv));
    }

    // Creates a statement that reads four elements from the SIMD vector 
    // 'vector' into 'arr[i]', 'arr[i+1]', etc...
    function vecWriteIndex(arr, arrIdx, vecName, iv) {
        var writes = [];
        for (var i = 0; i < vectorWidth; i++) {
            var idx = util.clone(arrIdx);
            var read = util.property(util.ident(vecName), vectorAccessors[i]); // vec.x, vec.y, ...
            var write = util.membership(arr, stepIndex(idx, iv, i), true);  // arr[2*i], arr[2*(i + 1)], ...
            writes[i] = util.assignment(write, read); 
        }
        return util.block(writes, false);
    }

    // Tests whether a node is a 'simple' variable. This means we can identify
    // this node completely by its name. This includes things such as
    // uncomputed member expressions and identifiers.
    function isSimpleVariable(node) {
        var simple = true;
        estraverse.traverse(node, {
            enter: function (node) {
                if (node.type === "Identifier") return;
                if (node.type === "MemberExpression" && node.computed === false) return;
                simple = false;
            }
        });
        return simple;
    }

    // Converts all assignemnts of the form x *= y into x = x * y. This makes
    // processing much easier!
    function canonicalizeAssignments(expr) {
        esrecurse.visit(expr, {
            AssignmentExpression: function (asgn) {
                // In case there are nested assignments...
                this.visit(asgn.right);
                this.visit(asgn.left);
                
                util.set(asgn, util.canonAssignment(asgn, 'strict'));
            },
            UpdateExpression: function (update) {
                // In case there are nested updates, uh oh...
                this.visit(update.argument);
                
                util.set(update, util.canonAssignment(update, 'strict'));
            }
        });
    }

    // Augments a loop AST with property 'invariant'. This property indicates
    // whether every node is loop invariant or not. This allows us to determine
    // whether certain operations are safe such as nested loops.
    // This definition of 'invariant' is slightly more conservative than need
    // be in that it will mark any variable defined in the loop as variant even
    // if its definition dominates all uses.
    function markLoopInvariant(ast, iv) {
       
        var valid = true;

        // defd_vars is a set containing the variables that are defined 
        // anywhere in the loop. If a variable is not in inv_vars and in 
        // defd_vars then it is not invariant.
        var defd_vars = {};
        defd_vars[iv.name] = true;

        // inv_vars is a set containing the variables that are DEFINITELY
        // invariant at the current point in the loop. This means they were
        // assigned some loop invariant expression.
        var inv_vars = {}; 

        // This variable is used by the conditional checker in order to check 
        // for variables that were newly defined in the branches.
        var defd_new = {};

        var READ = 0;
        var WRITE_INV = 1;
        var WRITE_VAR = 2;
        var mode = READ;

        function mark (node, val) {
            if (node.invariant !== val) {
                node.invariant = val;
                valid = false;
            }
        }

        function mark_var (node, dep) {
            if (mode === READ) {
                mark (node, nodekey(node) in inv_vars || !(nodekey(node) in defd_vars));
            } else {
                mark (node, mode === WRITE_INV);
                defd_vars[nodekey(node)] = true;
                defd_new[nodekey(node)] = true;
                if (mode === WRITE_INV) {
                    inv_vars[nodekey(node)] = dep || true;
                } else {
                    delete inv_vars[nodekey(node)];
                }
            }   
        }

        do {
            valid = true;
            esrecurse.visit(ast, {
                Literal: function (node) {
                    mark(node, true);
                },
                ThisExpression: function (node) {
                    mark_var(node);
                },
                Identifier: function (node) {
                    mark_var(node);
                },
                BinaryExpression: function (node) {
                    this.visit(node.left);
                    this.visit(node.right);
                    mark(node, node.left.invariant && node.right.invariant);
                },
                UnaryExpression: function (node) {
                    this.visit(node.argument);
                    mark(node, node.argument.invariant);
                },
                LogicalExpression: function (node) {
                    this.visit(node.left);
                    this.visit(node.right);
                    mark(node, node.left.invariant && node.right.invariant);
                },
                MemberExpression: function (node) {
                    if (!node.computed) {
                        // This is just like a variable.
                        mark_var(node);
                    } else {
                        var old_mode = mode;
                        mode = READ;
                        this.visit(node.object);
                        this.visit(node.property);
                        mode = old_mode;
                        if (node.object.invariant && node.property.invariant) {
                            // If the property is invariant, then we treat
                            // this node just like a variable.
                            mark_var(node, nodekey(node.object));
                        } else if (node.object.invariant) {
                            // The property isn't invariant. Invalidate
                            // everyone who is dependent on this array as we
                            // could be writing to any index.
                            for (elem in inv_vars) {
                                if (inv_vars[elem] === nodekey(node.object)) {
                                    delete inv_vars[elem];
                                }
                            }
                            mark (node, false);
                        } else {
                            // The object isn't invariant. This means we could
                            // be writing to ANY array so invalidate EVERYONE
                            // who depends on ANYTHING. This is a very
                            // conservative approach but alias tracking is hard
                            // so this is what we're gonna do.
                            for (elem in inv_vars) {
                                if (inv_vars[elem] !== true) {
                                    // This indicates it's not just a marker. 
                                    delete inv_vars[elem];
                                }
                            }
                            mark(node, false);
                        }
                    }
                },
                AssignmentExpression: function (node) {
                    var old_mode = mode;
                    mode = READ;
                    this.visit(node.right); 
                    mode = node.right.invariant ? WRITE_INV : WRITE_VAR;
                    this.visit(node.left);
                    mode = old_mode;
                    
                    // Since an assignment is the value of the left node, we'll
                    // mark it as such.
                    mark(node, node.left.invariant);
                },
                VariableDeclarator: function (node) {
                    if (node.init !== null) {
                        var old_mode = mode;
                        mode = READ;
                        this.visit(node.init);
                        mode = node.init.invariant ? WRITE_INV : WRITE_VAR;
                        this.visit(node.id);
                        mode = old_mode;

                        mark(node, node.id.invariant);
                    }
                },
                ConditionalExpression: function (node) {
                    this.visit(node.test);
                    this.visit(node.alternate);
                    this.visit(node.consequent);
                    mark(node, node.test.invariant && node.alternate.invariant && node.consequent.invariant);
                },
                CallExpression: function (node) {
                    var pseudo_this = this;
                    _.map(node.arguments, function (n) { pseudo_this.visit(n) });
                    mark(node, false); // We have no idea if this function is pure or not...
                },
                ArrayExpression: function (node) {
                    var pseudo_this = this;
                    _.map(node.elements, function (n) { pseudo_this.visit(n); });
                    mark (node, _.every(_.pluck(node.elements, 'invariant'), _.identity));
                },
                SequenceExpression: function (node) {
                    var pseudo_this = this;
                    _.map(node.expressions, function (n) { pseudo_this.visit(n); });
                    mark (node, _.last(node.expressions).invariant);
                },
                ObjectExpression: unsupported,
                NewExpression: unsupported,
                ArrowExpression: unsupported,
                YieldExpression: unsupported,
                ComprehensionExpression: unsupported,
                GeneratorExpression: unsupported,
                GraphExpression: unsupported,
                GraphIndexExpression: unsupported,
                UpdateExpression: function () { throw "update expression remains!" },

                IfStatement: function (node) {
                    this.visit(node.test);
                   
                    // Save the defd_new set so we can see what these branches
                    // define.
                    var pre_defd_new = defd_new;
                    defd_new = {};

                    // Save state to visit branch one.
                    var pre_inv_vars = inv_vars;
                    var pre_defd_vars = defd_vars;
                    inv_vars = util.clone(pre_inv_vars);
                    defd_vars = util.clone(pre_defd_vars);
                    this.visit(node.consequent);
                    
                    // Save state to visit branch two.
                    var b1_inv_vars = inv_vars;
                    var b1_defd_vars = defd_vars;
                    inv_vars = util.clone(pre_inv_vars);
                    defd_vars = util.clone(pre_defd_vars);
                    this.visit(node.alternate);
                    var b2_inv_vars = inv_vars;
                    var b2_defd_vars = defd_vars;
                   
                    // Merge invariant sets. Conditionals cannot introduce 
                    // any new invariant variables, but they can remove them.
                    inv_vars = pre_inv_vars;
                    inv_vars = _.pick(inv_vars, _.keys(b1_inv_vars));
                    inv_vars = _.pick(inv_vars, _.keys(b2_inv_vars));
                    inv_vars = _.omit(inv_vars, _.keys(defd_new));

                    // Merge defined sets.
                    defd_vars = pre_defd_vars;
                    defd_vars = _.extend(defd_vars, b1_defd_vars);
                    defd_vars = _.extend(defd_vars, b2_defd_vars);

                    // Restore the old defd_new set and update it with the new
                    // defined variables.
                    defd_new = _.extend(pre_defd_new, defd_new);
                },

                // This would be a HUGE pain.
                SwitchStatement: unsupported,
                WithStatement: unsupported,
            });
            inv_vars = {};
        } while (!valid);
    }

    function logInvariant(ast) {
        estraverse.traverse(ast, {
            enter: function (node) {
                if (node.invariant === true) {
                    console.log('Invariant: ' + escodegen.generate(node));
                } else if (node.invariant === false) {
                    console.log('Variant: ' + escodegen.generate(node));
                }
            },
        });
    }

    // Augments an expression AST with two properties: 'isvec' and 'isidx'.
    // 'isvec' indicates whether a node's value is a SIMD vector. 'isidx' 
    // indicates whether a node's value is derived from the induction variable.
    // This distinction is important at codegen time as we try not to convert 
    // indices blindly into vectors as this hurts performance. e.g.
    //      var arr = SIMD.float32x4(i, i+1, i+2, i+3);
    // is much more efficient than
    //      var idx = SIMD.float32x4(i, i+1, i+2, i+3);
    //      var arr = SIMD.float32x4(idx.x, idx.y, idx.z, idx.w);
    function markVectorExpressions(expr, iv, vectorVars) {
        
        esrecurse.visit(expr, {
            ThisExpression: function (node) {
                node.isvec = false;
                node.isidx = false;
            },
            Literal: function (node) {
                node.isvec = false;
                node.isidx = false;
            },
            Identifier: function (node) {
                node.isvec = nodekey(node) in vectorVars;
                node.isidx = node.name === iv.name;
                assert(!(node.isvec && node.isidx));
            },
            MemberExpression: function (node) {
                if (node.computed) {
                    // A computed access is a vector if the accessor is either
                    // a vector or an index. This is of the form 'obj[property]'
                    this.visit(node.property);
                    node.isvec = node.property.isvec || node.property.isidx;
                } else {
                    // An uncomputed access is a vector if a vector has been
                    // assigned to it.
                    node.isvec = nodekey(node) in vectorVars;
                    node.isidx = false;
                }
            },
            BinaryExpression: function (node) {
                this.visit(node.left);
                this.visit(node.right);

                // If a binary expression has a vector operand, then the entire
                // operation must be a vector.
                node.isvec = node.left.isvec || node.right.isvec;
                node.isidx = !node.isvec && (node.left.isidx || node.right.isidx);
            },
            UnaryExpression: function (node) {
                this.visit(node.argument);
                node.isvec = node.argument.isvec;
                ndoe.isidx = node.argument.isidx;
            },
            LogicalExpression: function (node) {
                this.visit(node.left);
                this.visit(node.right);
                node.isvec = node.left.isvec || node.right.isvec;
                node.isidx = !node.isvec && (node.left.isidx || node.right.isidx);
            },
            ConditionalExpression: function (node) {
                this.visit(node.test);
                this.visit(node.alternate);
                this.visit(node.consequent);
                node.isvec = node.test.isvec || node.alternate.isvec || node.consequent.isvec;
                node.isidx = !node.isvec && (node.test.isidx || node.alternate.isidx || node.consequent.isidx);
            },
            AssignmentExpression: function (node) {
                assert(node.left.type === 'Identifier' || node.left.type === 'MemberExpression');
                this.visit(node.right);

                if (isSimpleVariable(node.left)) {
                    // Remove this identifier from the list of vector variables. 
                    // This way, when we visit the LHS it will not be marked as a 
                    // vector if the OLD value of the LHS was a vector. e.g. in
                    //      var x = a[i];
                    //      x = 2;
                    // x should not be a vector in the second statement.
                    delete vectorVars[nodekey(node.left)];

                    // We don't need to visit the left node because it can't
                    // be a vector. LValues can only be vectors when they 
                    // depend on the induction variable which a simple variable
                    // can't.
                    node.isvec = node.right.isidx || node.right.isvec;
                    node.isidx = false;

                    // If this assignment is a vector, mark the LHS as a vector.
                    if (node.isvec) {
                        vectorVars[nodekey(node.left)] = util.clone(node.left);
                    }
                } else {
                    // This is not a simple variable. Make sure it's of the form:
                    //      obj.x.y.z[a*i + b]
                    // Otherwise we don't support it.
                    assert(node.left.type === 'MemberExpression');
                    if (!node.left.computed || !isSimpleVariable(node.left.object)) {
                        unsupported(node);
                    }

                    // Visit the LHS and assert it's a vector.
                    this.visit(node.left);
                    assert(node.left.isvec);
                    node.isvec = true;
                    node.isidx = false;
                }
            },
            SequenceExpression: function (node) {
                // The value of a sequence expression is the value of the last
                // expression in the sequence. Thus, if the last expression is
                // a vector, the entire sequence is a vector.
                for (var i = 0; i < node.expressions.length; i++) {
                    this.visit(node.expressions[i]);
                }
                node.isvec = node.expressions[node.expressions.length - 1].isvec;
                node.isidx = node.expressions[node.expressions.length - 1].isidx;
            },

            // Unsupported as of now. Can they be supported?
            ArrayExpression: unsupported,
            ObjectExpression: unsupported,
            ArrowExpression: unsupported,
            FunctionExpression: unsupported,
            NewExpression: unsupported,
            CallExpression: unsupported,
            YieldExpression: unsupported,
            ComprehensionExpression: unsupported,
            GeneratorExpression: unsupported,
            GraphExpression: unsupported,
            GraphIndexExpression: unsupported,
            
            // This should have been removed.
            UpdateExpression: function () { throw "update expression remains!";},
        });
    }

    // Vectorizes an expression. This implements the 'vec' rules.
    function vectorizeExpression(expr, iv, vectorMap, vectorVars, preEffects, postEffects) {
       
        // Augment with isidx/isvec properties.
        markVectorExpressions(expr, iv, vectorVars);
        if (!(expr.isvec || expr.isidx)) {
            trace("    Not a vector expression.");
            // No work to do. Bail out.
            return false;
        }

        // Whether we're on the READ or WRITE side of an assignment. This 
        // dictates how member expressions are vectorized.
        var READ = 0;
        var WRITE = 1;
        var mode = READ;

        // Whenever a node is visited, it must always transform itself so that
        // it is a vector.
        esrecurse.visit(expr, {
            Identifier: function (node) {
                // We only need to parallelize the identifier if we're 
                // reading. Otherwise it will just overwrite it. 
                if (mode == READ) {
                    if (node.isidx) {
                        // We're reading the induction variable. This means 
                        // we're using it as part of an arithmetic expression
                        // with a vector or that will be assigned to a 
                        // variable. In this case we follow the same process as
                        // when using a member expression like a[i].
                        var key = iv.name;
                        if (!(key in vectorMap)) {
                            var temp = mktemp(node);
                            preEffects.push(vecReadIndex(temp, node, iv));
                            vectorMap[key] = temp;
                        }

                        // Extract the temp and replace the current node.
                        var temp = vectorMap[key];
                        util.set(node, util.ident(temp));

                    } else if (node.isvec) {
                        // If what we're reading is already a vector, we don't
                        // need to do anything!
                        
                    } else {
                        // This is just a plain old variable. Splat it.
                        util.set(node, splat(util.clone(node)));
                    }
                }
            },
            Literal: function (node) {
                // Need to splat literals.
                util.set(node, splat(util.clone(node)));
            },
            BinaryExpression: function (node) {
                trace("Processing BINOP: " + escodegen.generate(node));
                if (!node.isvec) {
                    util.set(node, splat(util.clone(node)));
                    trace("    Splatting: " + escodegen.generate(node));
                    return;
                }
                
                // The result of this expression is a vector. Vectorize the
                // operands and use a vector expression.
                if (!(node.operator in vectorOp)) unsupported(node);
                this.visit(node.left);
                this.visit(node.right);
                util.set(node, util.call(vectorOp[node.operator], [node.left, node.right]));
                trace("    Vector: " + escodegen.generate(node));
            },
            LogicalExpression: function (node) {
                if (!node.isvec) { 
                    // Just a scalar logical, splat it.
                    util.set(node, splat(util.clone(node)));
                    return;
                } 
                
                // Apparently you can't do these in SIMD.
                unsupported(node);
            },
            UnaryExpression: function (node) {
                if (!node.isvec) {
                    util.set(node, splat(util.clone(node)));
                    return;
                }
                // Currently, no unary expressions are supported for floats.
                unsupported(node);
            },
            MemberExpression: function (node) {
                trace("Processing MEMBER: " + escodegen.generate(node));
                if (mode === WRITE && node.computed && !node.isvec) {
                    // Trying to use a computed node as a vector. We can't 
                    // support this as we can't track what variables are vectors
                    // and which aren't. Consider:
                    //      x[0] = a[i];
                    //      var y = x[f(0)];
                    //      a[i] = y;
                    // Is y a vector? Is it a constant?
                    unsupported(node);
                }

                if (mode === READ && !node.isvec) {
                    // This node is not a vector and we're reading. Splat it.
                    util.set(node, splat(util.clone(node)));
                    return;
                }

                if (node.property.isvec) {
                    // We currently don't suppot indexing by a vector because
                    // it's basically undecideable if it's safe. We SHOULD 
                    // support a mode that allows the user to bypass safety 
                    // checks in case they know better than us however!
                    unsupported(node);
                }

                // Extract the factors on the polynomial that is the index.
                var factors = util.getFactors(node.property);
                if (factors === null) {
                    // This means that the index was nonlinear. Currently this
                    // is unsupported because it's very difficult to determine
                    // if two accesses are the same (NP-Hard actually!). Again,
                    // we should support a mode that allows the user to bypass
                    // safety and let them take the responsibility for when 
                    // abs(x) and (x * sign(x)) collide! 
                    unsupported(node);
                }

                for (var term in factors.factors) {
                    if (term !== iv.name) {
                        // This means there was a non IV term in the index.
                        // Currently we don't support this because the term may
                        // be defined inside the loop and we would need to
                        // place the vector read AFTER it was defined.
                        unsupported(node);
                    }
                }
                // At this point we know that the index is of the form:
                //      a*iv + b
                // which is the only mode we currently support :(
                
                // Create a unique key for the node so we don't continually
                // recreate this vector.
                var key = vectorkey(node.object, factors);

                // When processing a member expression, it will either be when
                // reading from it or writing to it. This changes our behavior:
                if (mode === READ) {
                    // Performing a read. Convert this to a read from a temp
                    // and add a vector.
                    // Consider:
                    //      x = a[i];
                    // We want to compile this to:
                    //      temp1 = vec(a[i], a[i+1], a[i+2], a[i+3]);
                    //      x = temp1;
                
                    if (!(key in vectorMap)) {
                        // We have not seen this access before. Create a new
                        // temporary and add it to the preEffects.
                        var temp = mktemp(node.object);
                        vectorMap[key] = { name: temp, retired: false };
                        preEffects.push(vecReadIndex(temp, node, iv));
                    }

                    // Retrieve the temp from the vector map and use it.
                    var temp = vectorMap[key];
                    util.set(node, util.ident(temp.name));

                } else if (mode === WRITE) {
                    // Performing a write. Write to a temporary so the 
                    // assignment value remains the vector. We perform the 
                    // side effect AFTER the whole assignment is done.
                    // Consider: 
                    //      a = (b[i] = 2) + 3;
                    // We want to compile this to:
                    //      a' = (temp1 = splat(2)) + splat(3);
                    //      b[i] = temp1.x; b[i+1] = temp1.y; ...

                    if (!(key in vectorMap)) {
                        // We have not seen this write before. Create a new
                        // temporary and add it to the maps. It will be added
                        // to the post effects below.
                        var temp = mktemp(node.object);
                        vectorMap[key] = { name: temp, retired: false };
                    }

                    var temp = vectorMap[key];
                    if (!temp.retired) {
                        // This is the first write to this temp. Add a 
                        // writeback to the postEffects.
                        postEffects.push(vecWriteIndex(node.object, node.property, temp.name, iv));
                        temp.retired = true;
                    }

                    util.set(node, util.ident(temp.name));
                }
                trace("    Vector: " + escodegen.generate(node));
            },
            AssignmentExpression: function (node) {
                trace("Processing ASGN: " + escodegen.generate(node));
                assert(node.operator === '=');
                if (!node.isvec) {
                    util.set(node, splat(util.clone(node)));
                    trace("    Scalar: " + escodegen.generate(node));
                    return;
                }

                var oldMode = mode;
                mode = READ;
                this.visit(node.right);
                mode = WRITE;
                this.visit(node.left);
                mode = oldMode;
            },
            SequenceExpression: function (node) {
                // Visit all subexpressions in case they contain some vector 
                // expression with a side effect.
                for (var i = 0; i < node.expressions.length; i++) {
                    if (node.expressions[i].isvec) {
                        this.visit(node.expressions[i]);
                    }
                }

                // If last statement is not a vector (node.isvec == false) then
                // we need to splat this expression.
                if (!node.isvec) {
                    util.set(node, splat(util.clone(node)));
                }
            },

            // Unsupported as of now. Can they be supported?
            ArrayExpression: unsupported,
            ObjectExpression: unsupported,
            ArrowExpression: unsupported,
            FunctionExpression: unsupported,
            NewExpression: unsupported,
            CallExpression: unsupported,
            YieldExpression: unsupported,
            ComprehensionExpression: unsupported,
            GeneratorExpression: unsupported,
            GraphExpression: unsupported,
            GraphIndexExpression: unsupported,

            // This should have been removed.
            UpdateExpression: function () { throw "update expression remains!";},

        });
    
        return true;
    }
    
    function vectorizeStatement(stmt, iv, reductions) {
        
        // The current mapping of array accesses to their bound temps. The keys
        // are canonicalized versions of the index polynomials e.g. 
        //      a[2 * (i + 3) + 2 * 4]
        // will produce the key:
        //      a_2_i_14
        // TODO: it would be great to support nonlinear indexes too! 
        var vectorMap = {};

        // The current set of variables that are known vectors. These are 
        // always just strings, not AST elements.
        var vectorVars = {};
        for (var elem in reductions) {
            // Currently only ident reduction variables are supported but we
            // should allow any SimpleVariable.
            vectorVars[nodekey(util.ident(elem))] = util.clone(util.ident(elem));
        }

        // A list of statements that will populate temporaries needed in the 
        // statement.
        var preEffects = [];

        // A list of statements that retire temporaries generated in the 
        // statement to the appropriate arrays
        var postEffects = [];

        // Vectorize statements.
        esrecurse.visit(stmt, {
            
            ExpressionStatement: function (node) {
                trace("Processing STMT: " + escodegen.generate(node));
                vectorizeExpression(node.expression, iv, vectorMap, vectorVars, preEffects, postEffects);
            },

            VariableDeclarator: function (node) {
                trace("Processing DECL: " + escodegen.generate(node));
                if (node.id.type !== "Identifier") unsupported(node);
                if (vectorizeExpression(node.init, iv, vectorMap, vectorVars, preEffects, postEffects)) {
                    trace("    Vector: " + node.id.name);
                    vectorVars[nodekey(node.id)] = util.clone(node.id);
                } else {
                    trace("    Not a vector.");
                }   
            },
            
            ForStatement: function (node) {
                if (node.test !== null && node.test.invariant) {
                    trace("Processing FOR: " + escodegen.generate(node));
                    this.visit(node.body);
                } else {
                    trace ("Test not loop invariant: " + escodegen.generate(node.test));
                    unsupported(node);
                }
            },

            WhileStatement: function (node) {
                if (node.test.invariant) {
                    trace("Processing WHILE: " + escodegen.generate(node));
                    this.visit(node.body);
                } else {
                    trace ("Test not loop invariant: " + escodegen.generate(node.test));
                    unsupported(node);
                }
            },
            
            DoWhileStatement: function (node) {
                if (node.test.invariant) {
                    trace("Processing DOWHILE: " + escodegen.generate(node));
                    this.visit(node.body);
                } else {
                    trace ("Test not loop invariant: " + escodegen.generate(node.test));
                    unsupported(node);
                }
            },

            IfStatement: function (node) {
                trace("Procesing IF: " + escodegen.generate(node));
                this.visit(node.consequent);
                // TODO: optimization if condition is loop invariant.
            },


            LabeledStatement: unsupported,
            BreakStatement: unsupported,
            ContinueStatement: unsupported,
            WithStatement: unsupported,
            SwitchStatement: unsupported,
            ReturnStatement: unsupported,
            ThrowStatement: unsupported,
            ForInStatement: unsupported,
            ForOfStatement: unsupported,
            LetStatement: unsupported,
            FunctionDeclaration: unsupported,

        });

        // If the outermost statement of the loop is a block then we can mark
        // it as unneeded as it will be contained in the preEffects-postEffects
        // block.
        if (stmt.type === 'BlockStatement') {
            stmt.needed = false;
        }   

        // Now we need to add the side effects to our statement.
        util.set(stmt, util.block(preEffects.concat(util.clone(stmt)).concat(postEffects), true));

        // Return the set of vector variables which will be the liveouts of 
        // the loop.
        return vectorVars;
    }

    function updateLoopBounds(vecloop, loop, iv) {
        
        // Update the vectorized loop bounds and step. It is safe to iterate as
        // long as the highest index we will access (iv.step(vectorWidth-1)) 
        // does not violate the loop bounds.
        vecloop.test = estraverse.replace(vecloop.test, {
            leave: function (node) {
                if (node.type === 'Identifier' && node.name === iv.name) {
                    return iv.step(vectorWidth-1);
                }
            }
        }); 
        util.set(vecloop.update, util.assign(util.ident(iv.name), iv.step(vectorWidth)));
        
        // Remove the init from the scalar loop bounds so it continues where
        // the vector loop left off.
        loop.init = null;
    }

    // Resolves a reduction operator to the operator needed to combine the
    // lanes of the reduction.
    function resolveOp(ops) {
        
        function canonop(op) {
            if (op === '-') return '+';
            if (op === '/') return '*';
            return op;
        }
        var op = canonop(ops[0]);
        for (var i = 1; i < ops.length; i++) {
            if (op !== canonop(ops[i])) {
                throw ("invalid reduction operators: " + ops[0] + " and " + ops[i]);
            }
        }
        return op;
    }

    // At the beginning of the loop we need to initialize reduction variables
    // so that they're vectors:
    //      x = v(x, 0, 0, 0) for '+'
    //      x = v(x, 1, 1, 1) for '*'
    function initReductions(reductions) {
        var inits = [];
        for (var variable in reductions) {
            var id = util.ident(variable);
            var op = resolveOp(reductions[variable]);
            var identity = util.literal(op === '+' ? 0 : 1);
            inits.push(util.assignment(id, util.call(vectorConstructor, [id, identity, identity, identity])));
        }
        return util.block(inits, false);
    }

    // At the end of the loop, any reduction variable will be a vector 
    // containing reductions for each lane. This function performs reductions
    // on these vectors so they appear valid after the loop. 
    function performReductions(reductions, liveouts) {
        if (reductions.length === 0 && liveouts.length === 0) {
            // Nothing to do.
            return;
        }
        
        // Create an array that will hold all reduction assignment expressions.
        var stmts = [];

        // For reductions we just perform the reduction across the four lanes
        // of the vector.
        for (var name in reductions) {
            var op = resolveOp(reductions[name]);
            var red1 = util.binop(util.property(util.ident(name), 'x'), op, util.property(util.ident(name), 'y'));
            var red2 = util.binop(util.property(util.ident(name), 'z'), op, util.property(util.ident(name), 'w'));
            var red3 = util.binop(red1, op, red2);
            stmts.push(util.assignment(util.ident(name), red3));
        }

        // For liveouts we just use the last lane of the vector.
        for (var name in liveouts) {
            var node = liveouts[name];
            if (node.type === 'Identifier' && node.name in reductions) continue;
            stmts.push(util.assignment(node, util.property(node, 'w')));
        }

        return util.block(stmts, false); 
    }

    // Removes unneeded compound statements inserted when we needed to turn a 
    // single statement into multiple.
    function cleanupBlocks(ast) {
        
        esrecurse.visit(ast, {
            BlockStatement: function (node) {
                var cleaned = [];
                for (var i = 0; i < node.body.length; i++) {
                    var stmt = node.body[i];
                    this.visit(stmt);
                    if (stmt.type === 'BlockStatement' && stmt.needed === false) {
                        cleaned = cleaned.concat(stmt.body);
                    } else {
                        cleaned.push(stmt);
                    }
                }
                node.body = cleaned;
            }
        });
    }

    function vectorizeLoops(ast) {
       
        // We only know how to vectorize for loops at the moment.
        esrecurse.visit(ast, {
            ForStatement: function (node) {
                var vectorloop = util.clone(node);
                var scalarloop = util.clone(node);
                var iv = dependence.detectIV(vectorloop);
             
                // Perform some pre-processing to make things easier.
                canonicalizeAssignments(vectorloop.body);
                markLoopInvariant(vectorloop.body, iv);

                // Perform dependency analysis and find the reduction variables.
                var reductions = dependence.mkReductions(vectorloop, iv);
                if (reductions === null) {
                    throw 'unsupported reductions!';
                }

                // Initialize the reductions by assigning each reduction variable
                // an appropriate vector.
                var inits = initReductions(reductions);
                
                // Update the loop bounds so we perform as much of the loop in
                // vectors as possible. This converts:
                //      for (var i = 0; i < a.length; i++) 
                // into:
                //      for (var i = 0; (i + 3) < a.length; i = i + 4)
                //      for (; i < a.length; i++)
                updateLoopBounds(vectorloop, scalarloop, iv);
                var liveouts = vectorizeStatement(vectorloop.body, iv, reductions);
                console.log(liveouts);

                // Perform the reductions at the end of the loop.
                var retires = performReductions(reductions, liveouts);

                // Append the serial code to the vectorized code. This allows 
                // us to process loops of size not mod 4.
                util.set(node, util.block([inits, vectorloop, retires, scalarloop], true));
                cleanupBlocks(node);
            }
        });

    }

    function createFunction(ast) {
        
        // Extract the arguments.
        args = _.pluck(ast.params, 'name');

        // Create and return the function.
        var fn = new Function(args, escodegen.generate(ast.body));
        fn.name = ast.id.name;
        fn.displayName = ast.id.name;
        return fn;
    }

    function vectorizeFunction(fn) {
        if (typeof fn !== "function") {
            throw "argument must be a function";
        }

        var ret = {};

        try {
            // Parse the function to an AST and convert to a function expression so
            // we can return it.
            var ast = esprima.parse(fn.toString());
            var fn = ast.body[0];

            // Vectorize loops.
            vectorizeLoops(fn);

            // Convert the AST to a function object.
            ret.fn = createFunction(fn);
            ret.vectorized = true;
        } catch (err) {
            // We can't vectorize the function for some reason, just return 
            // the original function so that nothing breaks!
            console.log("Unable to vectorize function! " + err);
            ret.fn = fn;
            ret.vectorized = false;
            ret.reason = err; 
        }

        return ret;
    }
    
    var vectorize = {};
    vectorize.me = vectorizeFunction;
    return vectorize;
}());

