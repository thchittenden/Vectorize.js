vectorize = (function() {
  
    esprima = require('esprima');
    escodegen = require('escodegen');
    estraverse = require('estraverse');
    esrecurse = require('esrecurse');

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
    function nodekey(node) {
        // Need a unique string for the node! Uhhh...
        return escodegen.generate(node);
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
    
    // Create a statement that declares 'vector' and assigns four elements of
    // 'arr' to it.
    function vecReadVector(vector, arr, idxs) {
        var args = [];
        for (var i = 0; i < vectorWidth; i++) {
            args[i] = util.membership(util.ident(arr), util.property(idxs, vectorAccessors[i]), true);
        }

        // Return assignment 'vector = v(arr[idxs.x], arr[idxs.y], ...)'
        return util.declassignment(util.ident(vector), util.call(vectorConstructor, args));
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
    // 'vector' into 'arr[idxs.x]', 'arr[idxs.y]', etc...
    function vecWriteVector(arr, idxs, vector) {
        var writes = [];
        for (var i = 0; i < vectorWidth; i++) {
            var accessor = vectorAccessors[i];
            var read = util.property(util.ident(vector), accessor);
            var write = util.membership(arr, util.property(idxs, accessor), true);
            writes[i] = util.assignment(write, read);
        }
        return util.block(writes, false);
    }

    // Creates a statement that reads four elements from the SIMD vector 
    // 'vector' into 'arr[i]', 'arr[i+1]', etc...
    function vecWriteIndex(arr, arrIdx, vecName, iv) {
        var writes = [];
        for (var i = 0; i < vectorWidth; i++) {
            var idx = util.clone(arrIdx);
            var read = util.property(util.ident(vecName), vectorAccessors[i]); // vec.x, vec.y, ...
            var write = util.membership(arr, stepIndex(idx, iv, i), true);  // arr[2*i], arr[2*(i+1)], ...
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
                if (mode === READ) {
                    if (node.isidx) {
                        // We're reading the induction variable. This means 
                        // we're using it as part of an arithmetic expression
                        // with a vector or that will be assigned to a 
                        // variable. In this case we follow the same process as
                        // when using a member expression like a[i].
                        var key = nodekey(node); // Should be iv.name.
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

                // Cache the key since it will change when we visit the 
                // node property.
                var key = nodekey(node);

                // Otherwise, this is a vector member expression. When 
                // processing a member expression, it will either be when 
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

                        if (node.property.isvec) {
                            // Visit the property to coerce it to a vector.
                            this.visit(node.property);

                            // Now we need to create a new vector indexing with
                            // the lanes of the property:
                            //      v(a[prop.x], a[prop.y], ...);
                            // Currently this is unsupported as it will require
                            // converting this expression to a sequence 
                            // expression which assigns the property to a temp,
                            // then performs the dereference on the temp to
                            // avoid recalculating the indices four times.
                            // Consider:
                            //      a[b[i] + 2];
                            // This will be naively compiled to:
                            //      v(a[add(temp_b, splat(2)).x], a[add(temp_b, splat(2)).y], ...);
                            // While we want to compile it to:
                            //      (temp = add(temp_b, splat(2)), v(a[temp.x], b[temp.y], ...));
                            vectorMap[key] = { name: temp, retired: false };
                            preEffects.push(vecReadVector(temp, node.object.name, node.property));

                        } else {
                            assert(node.property.isidx);
                            // The index is based on the induction variable. 
                            // There is a problem if this property uses a 
                            // variable calculated AFTER the pre-effects. This 
                            // can be mitigated by making preeffects act
                            // immediately before the current expression 
                            // instead of before all statements in the block.
                            vectorMap[key] = { name: temp, retired: false };
                            preEffects.push(vecReadIndex(temp, node, iv));
                        }
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
                        if (node.property.isvec) {
                            // Visit the property to coerce it to a vector.
                            var oldMode = mode;
                            mode = READ;
                            this.visit(node.property);
                            mode = oldMode;
                            
                            // Construct the write and push it to the post effects.
                            postEffects.push(vecWriteVector(node.object, node.property, temp.name));

                        } else if (node.property.isidx) {
                            // The index is based on the induction variable.
                            // Generate a write block for the post effects.
                            postEffects.push(vecWriteIndex(node.object, node.property, temp.name, iv));

                        } else {
                            // The index is constant. This is a live-out dependency.
                            // We should be able to support this by just assigning the
                            // last element of the vector?
                            unsupported(node);

                        }
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
        
        // The current mapping of array accesses to their bound temps.
        // e.g. { a[i] -> temp1, b[2*i] -> temp2 }. 
        // TODO: if two accesses are for the same element but calculated in 
        // different ways (b[2*i], b[i*2]), they will end up as different 
        // elements in this map which will lead to a consistency problem:
        //      b[2*i] = 3; 
        //      b[i*2] = 4; 
        //      b[2*i] = 5; 
        // Compiles to:
        //      temp1 = splat(3);
        //      temp2 = splat(4);
        //      temp1 = splat(5);
        //      b[2*(i+0)] = temp1.x; b[2*(i+1)] = temp1.y; ...
        //      b[(i+0)*2] = temp2.x; b[(i+1)*2] = temp2.y; ...
        // This could be fixed by detecting identical accesses and treating 
        // them as the same key or outlawing different accesses to the same 
        // array (though this seems a little draconian).
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
            },

            IfStatement: unsupported,
            LabeledStatement: unsupported,
            BreakStatement: unsupported,
            ContinueStatement: unsupported,
            WithStatement: unsupported,
            SwitchStatement: unsupported,
            ReturnStatement: unsupported,
            ThrowStatement: unsupported,
            WhileStatement: unsupported,
            DoWhileStatement: unsupported,
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

        // TODO: Temporarily returning vectorVars so we can determine 
        // if a reduction variable is valid or not. Once reduction variables 
        // are automatically detected this won't be necessary.
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

    // At the end of the loop, any reduction variable will be a vector 
    // containing reductions for each lane. This function performs reductions
    // on these vectors so they appear valid after the loop. 
    function performReductions(loop, reductions, liveouts) {
        if (reductions.length === 0 && liveouts.length === 0) {
            // Nothing to do.
            return;
        }
        
        // Create an array that will hold all reduction assignment expressions.
        var stmts = [clone(loop)];

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
            var liveout = liveouts[i];
            var name = liveout.name;
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
       
        // We only know how to vectorize for loops at the moment. And they'll
        // be wrong if they don't iterate some multiple of 4 times.
        esrecurse.visit(ast, {
            ForStatement: function (node) {
                var vectorloop = util.clone(node);
                var scalarloop = util.clone(node);
                
                // Detect the induction variable in the loop.
                var iv = dependence.detectIV(node);
                //console.log(dependence.mkReductions(scalarloop, iv));
                
                // Get the reduction operations in the loop. This should be 
                // auto-detected in the future.
                var reductions = [];
                var liveouts = [];
                
                // Update the loop bounds so we perform as much of the loop in
                // vectors as possible. This converts:
                //      for (var i = 0; i < a.length; i++) 
                // into:
                //      for (var i = 0; (i + 3) < a.length; i = i + 4)
                //      for (; i < a.length; i++)
                updateLoopBounds(vectorloop, scalarloop, iv);
                vectorizeStatement(vectorloop.body, iv);
                cleanupBlocks(vectorloop.body);
                performReductions(vectorloop, reductions, liveouts);

                // Append the serial code to the vectorized code. This allows 
                // us to process loops of size not mod 4.
                util.set(node, util.block([vectorloop, scalarloop], true));
            }
        });

    }

    function vectorizeFunction(fn) {
        if (typeof fn !== "function") {
            throw "argument must be a function";
        }

        // Parse the function to an AST and convert to a function expression so
        // we can return it.
        var ast = esprima.parse(fn.toString());
        ast = makeFunctionExpression(ast);
        console.log(fn.toString());    

        // Vectorize loops.
        vectorizeLoops(ast);

        // Transform the AST back to a function string.
        var fnstr = escodegen.generate(ast);
        console.log(fnstr);

        

        // Convert the string to a javascript function and return it.
        return eval(fnstr);
    }
    
    var vectorize = {};
    vectorize.me = vectorizeFunction;
    return vectorize;
}());

