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
    function nodekey(node) {
        // Need a unique string for the node! Uhhh...
        return escodegen.generate(node);
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

    // Logging functions.
    function trace(str) {
        console.log(str);
    }

    function splat (val) {
        return util.call(util.property(vectorConstructor, 'splat'), [val]);
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

    // Create a statement that reads four elements of 'arr' into a SIMD vector
    // and assigns it to 'vector'.
    function vecRead(vector, arr, idxs) {
        var args = [];
        for (var i = 0; i < vectorWidth; i++) {
            args[i] = util.membership(util.ident(arr), util.property(idxs, vectorAccessors[i]), true);
        }

        // Return assignment 'vector = v(arr[idxs.x], arr[idxs.y], ...)'
        return util.assignment(util.ident(vector), util.call(vectorConstructor, args));
    }

    // Creates a statement that reads four elements from the SIMD vector 
    // 'vector' into 'arr[idxs.x]', 'arr[idxs.y]', etc...
    function vecWrite(arr, idxs, vector) {
        var writes = [];
        
        // If the index is not just an identifier (i.e. computation is 
        // involved), cache the result to a temp so we don't repeat it four 
        // times!
        if (idxs.type !== 'Identifier') {
            var temp = 'temp' + tempIdx++;
            writes.push(util.assignment(util.ident(temp), idxs));
            idxs = util.ident(temp); 
        }

        // Construct the writes: arr[idxs.x] = vec.x, ...
        for (var i = 0; i < vectorWidth; i++) {
            var accessor = vectorAccessors[i];
            var read = util.property(util.ident(vector), accessor); // vec.x, vec.y, ...
            var write = util.membership(util.ident(arr), util.property(idxs, accessor), true);  // arr[idxs.x], arr[idxs.y], ...
            writes.push(util.assignment(write, read)); 
        }
        return util.block(writes);
    }

    // Augments an expression AST with a property 'isvec' which indicates 
    // whether that node needs to be vectorized or not. Updates the vectorVars
    // argument to reflect the vector variables live AFTER the expression.
    function markVectorExpressions(expr, iv, vectorVars) {
        
        esrecurse.visit(expr, {
            ThisExpression: function (node) {
                node.isvec = false;
            },
            Identifier: function (node) {
                node.isvec = node.name === iv.name || node.name in vectorVars;
            },
            Literal: function (node) {
                node.isvec = false;
            },
            MemberExpression: function (node) {
                if (node.computed) {
                    // A computed access is a vector if the accessor is a 
                    // vector. This is of the form 'obj[property]'
                    this.visit(node.property);
                    node.isvec = node.property.isvec;
                } else {
                    // An uncomputed access is never a vector. This is of the
                    // form 'obj.property'.
                    node.isvec = false;
                }
            },
            BinaryExpression: function (node) {
                this.visit(node.left);
                this.visit(node.right);
                node.isvec = node.left.isvec || node.right.isvec;
            },
            UnaryExpression: function (node) {
                this.visit(node.argument);
                node.isvec = node.argument.isvec;
            },
            UpdateExpression: function (node) {
                this.visit(node.argument);
                node.isvec = node.argument.isvec;
            },
            LogicalExpression: function (node) {
                this.visit(node.left);
                this.visit(node.right);
                node.isvec = node.left.isvec || node.right.isvec;
            },
            ConditionalExpression: function (node) {
                this.visit(node.test);
                this.visit(node.alternate);
                this.visit(node.consequent);
                node.isvec = node.test.isvec || node.alternate.isvec || node.consequent.isvec;
            },
            AssignmentExpression: function (node) {
                this.visit(node.right);
                
                // Remove this identifier from the list of vector variables. 
                // This way, when we visit the LHS it will only be marked as a
                // vector if it is a vector MemberExpression.
                if (node.left.type === "Identifier") {
                    delete vectorVars[node.left.name];
                }
                this.visit(node.left);

                // An assignment is a vector if we either read from a vector or
                // assign to an array.
                node.isvec = node.right.isvec || node.left.isvec;
               
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
        });
    }

    // Vectorizes an expression. This implements the 'vec' rules.
    function vectorizeExpression(expr, iv, vectorMap, vectorVars, preEffects, postEffects) {
        
        markVectorExpressions(expr, iv, vectorVars);
        if (!expr.isvec) {
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
                    if (node.isvec) {
                        // If what we're reading is already a vector, we don't
                        // need to do anything unless its the induction 
                        // variable in which case we need to replace it with
                        // the vector variable.
                        if (node.name === iv.name) {
                            util.set(node, iv.vector);
                        }
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
            UpdateExpression: function (node) {
                if (!node.isvec) {
                    util.set(node, splat(util.clone(node)));
                } 

                // You can only perform update expressions on identifiers. RIGHT?
                // In this case, we perform the following transformations:
                //      x++     ->      (x = x + 1, x - 1)
                //      ++x     ->      (x = x + 1)
                // And likewise for --.
                // I'm too lazy to implement this now.
                unsupported(node);
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
                    // This is a non-vector member access. It may use a non-IV
                    // index or a non-computed index. Just splat it in this 
                    // case.
                    util.set(node, splat(util.clone(node)));
                    trace("    Scalar: " + escodegen.generate(node));
                    return;
                } 
                
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
                    
                    if (!(nodekey(node) in vectorMap)) {
                        // We have not seen this access before. Create a new
                        // temporary and add it to the preEffects.
                        var temp = 'temp' + tempIdx++ + '_' + node.object.name;

                        // Visit the property. This is now a vector.
                        this.visit(node.property);
                        preEffects.push(vecRead(temp, node.object.name, node.property));
                        vectorMap[nodekey(node)] = { name: temp, inPostEffects: false};
                    }

                    // We have either already read from or written to this node.
                    // In either of these cases, we do not want to add it to the
                    // preeffects array, we just want to use the most recent tmep.
                    var temp = vectorMap[nodekey(node)];
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

                    if (!(nodekey(node) in vectorMap)) {
                        // We have not seen this write before. Create a new
                        // temporary and add it to the maps. It will be added
                        // to the post effects below.
                        temp = 'temp' + tempIdx++ + '_' + node.object.name;
                        vectorMap[nodekey(node)] = { name: temp, inPostEffects: false};
                    }
                    
                    var temp = vectorMap[nodekey(node)];
                    if (!temp.inPostEffects) {
                        // This is the first write to this array, add it to the
                        // postEffects array.
                        var oldMode = mode;
                        mode = READ;
                        this.visit(node.property);
                        mode = oldMode;
                        postEffects.push(vecWrite(node.object.name, node.property, temp.name));
                        temp.inPostEffects = true;
                    }
                    util.set(node, util.ident(temp.name));
                }
                trace("    Vector: " + escodegen.generate(node));
            },
            AssignmentExpression: function (node) {
                trace("Processing ASGN: " + escodegen.generate(node));
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

        // Initialize maps with the index variable because someone is PROBABLY
        // gonna use it!
        var temp = 'temp' + tempIdx++ + '_' + iv.name;
        var indexVec = util.assignment(util.ident(temp), util.call(vectorConstructor, []));
        for (var i = 0; i < vectorWidth; i++) {
            indexVec.expression.right.arguments[i] = iv.step(i);   
        }
        preEffects.push(indexVec);
        iv.vector = util.ident(temp);

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
            ForStatement: unsupported,
            ForInStatement: unsupported,
            ForOfStatement: unsupported,
            LetStatement: unsupported,
            FunctionDeclaration: unsupported,

        });

        // Now we need to add the side effects to our statement.
        util.set(stmt, util.block(preEffects.concat(util.clone(stmt)).concat(postEffects)));
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

    function vectorizeLoops(ast) {
       
        // Construct our induction variable. This should be auto-detected in
        // the future!
        var iv = {
            name: "i",
            step: function (i) {
                return esprima.parse("i+"+i).body[0].expression;
            }
        };

        // We only know how to vectorize for loops at the moment. And they'll
        // be wrong if they don't iterate some multiple of 4 times.
        esrecurse.visit(ast, {
            ForStatement: function (node) {
                var vectorloop = util.clone(node);
                var scalarloop = util.clone(node);
                
                // Update the loop bounds so we perform as much of the loop in
                // vectors as possible. This converts:
                //      for (var i = 0; i < a.length; i++) 
                // into:
                //      for (var i = 0; (i + 3) < a.length; i = i + 4)
                //      for (; i < a.length; i++)
                updateLoopBounds(vectorloop, scalarloop, iv);
                vectorizeStatement(vectorloop.body, iv);

                // Append the serial code to the vectorized code. This allows 
                // us to process loops of size not mod 4.
                util.set(node, util.block([vectorloop, scalarloop]));
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
        //console.log(JSON.stringify(ast, null, 2));
        var fnstr = escodegen.generate(ast);
        console.log(fnstr);

        // Convert the string to a javascript function and return it.
        return eval(fnstr);
    }
    
    var vectorize = {};
    vectorize.me = vectorizeFunction;
    return vectorize;
}());
