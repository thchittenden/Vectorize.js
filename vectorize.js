vectorize = (function() {
  
    var esprima = require('esprima');
    var escodegen = require('escodegen');
    var estraverse = require('estraverse');
    var esrecurse = require('esrecurse');
    var _ = require('underscore');

    function unsupported(node) {
        throw ("unsupported operation: " + escodegen.generate(node))
    }
    function assert(cond) {
        if (!cond) throw "assertion failed"
    }
    function trace(str) {
        console.log(str);
    }
   
    // SIMD properties.
    var vectorWidth = 4;
    var vectorAccessors = ['x', 'y', 'z', 'w'];
    var vectorConstructor = util.property(util.ident('SIMD'), 'float32x4'); 
    var vectorOp = {}
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

    // Creates a unique key for an array and its linear index. Given something
    // like (obj.arr[a*i + b]) we'll get a string: 'obj_arr_a_i_b'.
    function vectorkey(arr, idxfactors) {
        
        // Create a string for the array.
        var id = escodegen.generate(arr);
        id = id.replace(/[-\+\*\/\.\[\]]/g, '_') + '_';

        // Append keys for the factors.
        for (var elem in idxfactors.factors) {
            id += idxfactors.factors[elem] + "_" + elem + "_";
        }
        id += idxfactors.constant;

        return id;
    }
    function mktemp(node) {
        var id = escodegen.generate(node);
        var safe_id = id.replace(/[-\+\*\/\.\[\]]/g, '_');
        return 'temp' + tempIdx++ + '_' + safe_id;
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
        return expr;
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
                node.isvec = node.name in vectorVars;
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
                    // An uncomputed access is never a vector. This is of the
                    // form 'obj.property'.
                    node.isvec = false;
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
                this.visit(node.right);
                
                // Remove this identifier from the list of vector variables. 
                // This way, when we visit the LHS it will not be marked as a 
                // vector if the OLD value of the LHS was a vector. e.g. in
                //      var x = a[i];
                //      x = 2;
                // x should not be a vector in the second statement.
                if (node.left.type === "Identifier") {
                    delete vectorVars[node.left.name];
                }
                this.visit(node.left);

                // An assignment is a vector in two cases: 
                //      1. The LHS is a vector meaning it will eventually need 
                //          to be retired to an array (e.g. a[i] = 2);
                //      2. The RHS is either a vector or an index. We cannot 
                //         preserve 'isidx' as given the current expression we
                //         do not know how the result will be used. For 
                //         performant code, make sure not to assign the index 
                //         before using it to index!
                node.isvec = node.right.isidx || node.right.isvec || node.left.isvec;
                node.isidx = false;
               
                // If this node was a vector and the LHS was an identifier, 
                // that identifier is now a vector.
                if (node.isvec && node.left.type === "Identifier") {
                    vectorVars[node.left.name] = true;
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
            UpdateExpression: function () { throw "update expression remains!" },
        });
    }

    // Vectorizes an expression. This implements the 'vec' rules.
    function vectorizeExpression(expr, iv, vectorMap, vectorVars, preEffects, postEffects) {
       
        // Remove any ++, --, +=, etc...
        canonicalizeAssignments(expr);

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
                if (!node.isvec) {
                    // This node is not a vector. Splat it.
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

                for (term in factors.factors) {
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
            UpdateExpression: function () { throw "update expression remains!" },

        });
    
        return true;
    }
    
    function vectorizeStatement(stmt, iv) {
        
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
                    vectorVars[node.id.name] = true;
                } else {
                    trace("    Not a vector.");
                }   
            },
            
            ForStatement: function (node) {
                trace("Processing FOR: " + escodegen.generate(node));
                this.visit(node.body);
                // TODO: assert the index/update/condition are loop invariant.
            },

            WhileStatement: function (node) {
                trace("Processing WHILE: " + escodegen.generate(node));
                this.visit(node.body);
                // TODO: assert the condition is loop invariant.
            },
            
            DoWhileStatement: function (node) {
                trace("Processing DOWHILE: " + escodegen.generate(node));
                this.visit(node.body);
                // TODO: assert the condition is loop invariant.
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

    // At the end of the loop, any reduction variable will be a vector 
    // containing reductions for each lane. This function performs reductions
    // on these vectors so they appear valid after the loop. 
    function performReductions(loop, reductions, liveouts) {
        if (reductions.length === 0 && liveouts.length === 0) {
            // Nothing to do.
            return;
        }
        
        // Create an array that will hold all reduction assignment expressions.
        var stmts = [util.clone(loop)];

        // For reductions we just perform the reduction across the four lanes
        // of the vector.
        for (var i = 0; i < reductions.length; i++) {
            var reduction = reductions[i];
            var name = reduction.name;
            var op = reduction.op;
            var red1 = util.binop(util.property(util.ident(name), 'x'), op, util.property(util.ident(name), 'y'));
            var red2 = util.binop(util.property(util.ident(name), 'z'), op, util.property(util.ident(name), 'w'));
            var red3 = util.binop(red1, op, red2);
            stmts.push(util.assignment(util.ident(name), red3));
        }

        // For liveouts we just use the last lane of the vector.
        for (var i = 0; i < liveouts.length; i++) {
            var name = liveouts[i].name;
            stmts.push(util.assignment(util.ident(name), util.property(util.ident(name), 'w')));
        }

        util.set(loop, util.block(stmts, false));
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
                
                // Detect the induction variable in the loop.
                var iv = dependence.detectIV(node);
                //console.log(dependence.mkReductions(scalarloop, iv));
                
                // Get the reduction operations in the loop. This should be 
                // auto-detected in the future.
                var valid = dependence.mkReductions(node, iv);
                if (valid === null) {
                    // Safety checks determined we can't vectorize. Bail out.
                    throw "dependency check failure"
                }
                var reductions = valid.reductions;
                var liveouts = valid.liveouts;
                
                // Update the loop bounds so we perform as much of the loop in
                // vectors as possible. This converts:
                //      for (var i = 0; i < a.length; i++) 
                // into:
                //      for (var i = 0; (i + 3) < a.length; i = i + 4)
                //      for (; i < a.length; i++)
                updateLoopBounds(vectorloop, scalarloop, iv);
                vectorizeStatement(vectorloop.body, iv);
                cleanupBlocks(vectorloop.body);

                // Update the reductions so they contain the operation as well.
                detectOperations(reductions);
                performReductions(vectorloop, reductions, liveouts);

                // Append the serial code to the vectorized code. This allows 
                // us to process loops of size not mod 4.
                util.set(node, util.block([vectorloop, scalarloop], true));
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

