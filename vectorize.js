vectorize = (function() {
    
    // Utility functions for creating AST elements.
    function ident(name) {
        return {
            type: 'Identifier',
            name: name
        }
    }
    function literal(val) {
        return {
            type: 'Literal',
            value: val
        }
    }
    function assignment(left, right) {
        return {
            type: 'ExpressionStatement',
            expression: {
                type: 'AssignmentExpression',
                operator: '=',
                left: left,
                right: right
            }
        }
    }
    function membership(obj, prop, computed) {
        return {
            type: 'MemberExpression',
            computed: computed,
            object: obj,
            property: prop
        }
    }
    function call(fn, args) {
        return {
            type: 'CallExpression',
            callee: fn,
            arguments: args
        }
    }
    function binop(left, op, right) {
        return {
            type: 'BinaryExpression',
            operator: op,
            left: left,
            right: right
        }
    }
    function block(stmts) {
        return {
            type: 'BlockStatement',
            body: stmts
        }
    }
    function splat(val) {
        return call(membership(vectorConstructor, ident('splat'), false), [val]);
    }
    function sequence(exprs) {
        return {
            type: 'SequenceExpression',
            expressions: exprs
        }
    }
    function set(node1, node2) {
        // Clear unneeded properties.
        for (var prop in node1) {
            if (!(prop in node2)) {
                delete node1[prop];
            }
        }
        
        // Set new properties.
        for (var prop in node2) {
            node1[prop] = node2[prop];
        }
    }
   
    // SIMD properties.
    var vectorWidth = 4;
    var vectorAccessors = ['x', 'y', 'z', 'w'];
    var vectorConstructor = membership(ident('SIMD'), ident('float32x4'), false); 
    var vectorOp = {}
    vectorOp['+'] = membership(vectorConstructor, ident('add'), false);
    vectorOp['-'] = membership(vectorConstructor, ident('sub'), false);
    vectorOp['*'] = membership(vectorConstructor, ident('mul'), false);
    vectorOp['/'] = membership(vectorConstructor, ident('div'), false);

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

    function isVectorIndex(node, vector, iv) {
        return node.type === "MemberExpression" 
            && node.object.name === vector
            && node.property.name === iv;
    }

    // Create a statement that reads four elements of 'arr' into a SIMD vector
    // and assigns it to 'vector'.
    function vecRead(vector, arr, iv) {
        // Write to 'vector'
        var left = ident(vector)         

        // Read from 'arr[iv]'
        var args = [];
        for (var i = 0; i < vectorWidth; i++) {
            args[i] = membership(ident(arr), binop(ident(iv), '+', literal(i)), true);
        }
        var right = call(vectorConstructor, args);

        // Return assignment.
        return assignment(left, right);
    }

    // Creates a statement that reads four elements from the SIMD vector 
    // 'vector' into 'arr[iv(0)]', 'arr[iv(1)]', etc...
    function vecWrite(arr, iv, vector) {
        
        var writes = [];
        for (var i = 0; i < vectorWidth; i++) {
            var read = membership(ident(vector), ident(vectorAccessors[i]), false); // vec.x, vec.y, ...
            var write = membership(ident(arr), binop(ident(iv), '+', literal(i)), true);  // arr[i+0], arr[i+1], ...
            writes[i] = assignment(write, read); 
        }
        return block(writes);
    }

    // Modify node such that it executes all side effects in order. 
    function addSideEffects(preEffects, node, postEffects) {
        
        // Construct the copy child node.
        child = {};
        for (var prop in node) {
            child[prop] = node[prop];
        }   

        stmts = preEffects;
        stmts.push(child);
        for (var key in postEffects) {
            stmts.push(postEffects[key]); 
        }
            
        set(node, block(stmts));
    }

    function shouldVectorizeStatement(stmt, vectorVars, iv) {
        
        var vectorize = false;
        esrecurse.visit(stmt, {
            Identity: function (node) {
                if (vectorVars.has(node.name)) {
                    vectorize = true;
                }
            },
            MemberExpression: function (node) {
                if (node.property.name === iv) {
                    vectorize = true;
                }
            }
        });
        return vectorize;

    }

    function updateLoopBounds(update) {
        newupdate = {};
        set(newupdate, update);
        set(update, sequence([newupdate, newupdate, newupdate, newupdate]));
    }

    // Vectorizes all occurrences of accesses to a given vector in the AST.
    function vectorizeVariable(ast, iv) {
      
        // State variables during the traversal.
        var vectorMap = {};             // Map from array access to its temp.
        var vectorVars = new Set();     // Current vector variables.
        var tempIdx = 0;
        var preEffects = [];
        var postEffects = {};
        var NONE = 0;
        var READ = 1;
        var WRITE = 2;
        var mode = NONE;

        esrecurse.visit(ast, {
            MemberExpression: function (node) {
                if (mode === READ) {
                    // Performing a read. Convert this to a read from a temp
                    // and add a vector.
                    // Consider:
                    //      x = a[i];
                    // We want to compile this to:
                    //      temp1 = vec(a[i], a[i+1], a[i+2], a[i+3]);
                    //      x = temp1;
                 
                    console.log("Processing READ: " + escodegen.generate(node));
                    if (!(node in vectorVars)) {
                        // Haven't seen this vector. Create a new one.
                        var temp = 'temp' + tempIdx++ + '_' + node.object.name;
                        console.log("    Generating into " + temp);
                        preEffects.push(vecRead(temp, node.object.name, node.property.name));
                        vectorMap[node] = temp;
                        vectorVars.add(temp);
                    }

                    // Make this node point to the vector.
                    var temp = vectorMap[node];
                    console.log("    Using " + temp);

                    set(node, ident(temp));
                } else if (mode === WRITE) {
                    // Performing a write. Write to a temporary so the 
                    // assignment value remains the vector. We perform the 
                    // side effect AFTER the whole assignment is done.
                    // Consider: 
                    //      a = (b[i] = 2) + 3;
                    // We want to compile this to:
                    //      a' = (temp1 = splat(2)) + splat(3);
                    //      b[i] = temp1.x; b[i+1] = temp1.y; ...
                    
                    console.log("Processing WRITE: " + escodegen.generate(node));
                    temp = 'temp' + tempIdx++ + '_' + node.object.name;
                    console.log("    Generating into " + temp);
                    postEffects[node.object.name] = vecWrite(node.object.name, node.property.name, temp);
                    vectorMap[node] = temp;
                    vectorVars.add(temp);

                    set(node, ident(temp));
                } else {
                    throw "array access outside of assignment!"
                }
            },

            Identifier: function (node) {
                if (mode == NONE) {
                    return;
                }

                if (node.name in vectorVars) {
                    return;
                } else {
                    // Not a vector, need to splat it!
                    newnode = {};
                    set(newnode, node);
                    set(node, splat(newnode));
                }
            },

            Literal: function (node) {
                if (mode == NONE) {
                    return;
                }

                newnode = {};
                set(newnode, node);
                set(node, splat(newnode));
            },

            BinaryExpression: function (node) {
                if (mode == NONE) {
                    return;
                }
                console.log("Processing BINOP: " + escodegen.generate(node));
                if (!(node.operator in vectorOp)) {
                    throw ("bad binop " + node.operator)
                }
                this.visit(node.left);
                this.visit(node.right);
                set(node, call(vectorOp[node.operator], [node.left, node.right])); 
            },

            AssignmentExpression: function (node) {
                console.log("Processing ASSIGNMENT: " + escodegen.generate(node));
                var oldMode = mode;
                mode = READ;
                this.visit(node.right);
                mode = WRITE;
                this.visit(node.left);
                mode = oldMode;
            },
            
            VariableDeclarator: function (node) {
                if (shouldVectorizeStatement(node, vectorVars, iv)) {
                    console.log("Processing DECL: " + escodegen.generate(node));
                    mode = READ;
                    this.visit(node.init);
                    vectorVars.add(node.id.name);
                    mode = NONE;
                }
            },

            ExpressionStatement: function(node) {
                if (shouldVectorizeStatement(node, vectorVars, iv)) {
                    // There was some vector expression in this statement, need
                    // to vectorize it.
                    console.log("Processing STMT: " + escodegen.generate(node));
                    this.visit(node.expression);
                }
            }

        });

        // Add preeffects and posteffects to the function.
        addSideEffects(preEffects, ast, postEffects);
    }

    function vectorizeFunction(fn) {
        if (typeof fn !== "function") {
            throw "argument must be a function";
        }

        // Parse the function to an AST and convert to a function expression so
        // we can return it.
        var ast = esprima.parse(fn.toString());
        ast = makeFunctionExpression(ast);

        // Transform the loop.
        esrecurse.visit(ast, {
            ForStatement: function (node) {
                updateLoopBounds(node.update);
                vectorizeVariable(node.body, "i") 
            }
        });

        // Transform the AST back to a function string.
        console.log(JSON.stringify(ast, null, 2));
        var fnstr = escodegen.generate(ast);
        console.log(fnstr);

        // Convert the string to a javascript function and return it.
        return eval(fnstr);
    }
    
    var vectorize = {};
    vectorize.me = vectorizeFunction;
    return vectorize;
}());
