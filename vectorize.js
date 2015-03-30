var vectorize = (function() {


    var vectorWidth = 4;
    var vectorConstructor = {
        'type': 'MemberExpression',
        'computed': 'false', // ???
        'object': { 'type': 'Identifier', 'name': 'SIMD' },
        'property': { 'type': 'Literal', 'value': 'float32x4' }
    };

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

    function isArrayIndex(node, vector, iv) {
        return node.type === "MemberExpression" 
            && node.object.name === vector
            && node.property.name === iv;
    }

    // Implements x = a[i] to x = vec(a[i], a[i+1], a[i+2], a[i+3])
    function vectorizeReadVector(vector, iv) {
        var read = {
            'type': 'CallExpression',
            'callee': vectorConstructor,
            'arguments': []
        };

        for (var i = 0; i < vectorWidth; i++) {
            read['arguments'][i] = {
                type: 'MemberExpression',
                computed: 'true',
                object: { type: 'Identifier', name: vector },
                property: { 
                    type: 'BinaryExpression',
                    operator: '+',
                    left: { type: 'Identifier', name: iv },
                    right: { type: 'Literal', value: i, raw: i }
                }
            }
        }

        return read;
    }

    // Vectorizes all occurrences of accesses to a given vector in the AST.
    function vectorizeVariable(ast, vector, iv) {
        esrecurse.visit(ast, {
            AssignmentExpression: function (node) {
                if (isArrayIndex(node.right, vector, iv)) {
                    // Update RHS to be SIMD and add LHS to list of vectors.
                    console.log("Vectorizing assignment " + escodegen.generate(node));
                    node.right = vectorizeReadVector(vector, iv);
                }
            },
            
            VariableDeclarator: function (node) {
                if (isArrayIndex(node.init, vector, iv)) {
                    node.init = vectorizeReadVector(read, iv);
                }
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

        // Transform the loop.
        esrecurse.visit(ast, {
            ForStatement: function (node) { vectorizeVariable(node, "a", "i") }
        });

        // Transform the AST back to a function string.
        var fnstr = escodegen.generate(ast);
        console.log(JSON.stringify(ast, null, 2));
        console.log(fnstr);

        // Convert the string to a javascript function and return it.
        return eval(fnstr);
    }
    
    var vectorize = {};
    vectorize.me = vectorizeFunction;
    return vectorize;
}());
