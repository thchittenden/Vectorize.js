var vectorize = (function() {

    var vectorize = {};

    function makeFunctionExpression(ast) {
        // Converts a function to a function expression so we can manipulate 
        // it like an object.
        if (ast.body[0].type === "FunctionDeclaration") {
            var fn = ast.body[0];
            fn.type = "FunctionExpression";
            fn.id = null;
            ast.body[0] = { type: "ExpressionStatement", expression: fn };
        } 
        return ast;
    }

    vectorize.me = function(fn) {
        if (typeof fn !== "function") {
            throw "argument must be a function";
        }

        // Parse the function to an AST and convert to a function expression so
        // we can return it.
        var ast = esprima.parse(fn.toString());
        ast = makeFunctionExpression(ast);

        // Transform the AST back to a function string.
        var fnstr = escodegen.generate(ast);
        console.log(fnstr);

        // Convert the string to a javascript function and return it.
        return eval(fnstr);
    }

    return vectorize;

}());
