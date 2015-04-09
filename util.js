util = (function(){
    var util = {};

    // Utility functions for creating AST elements.
    util.ident = function (name) {
        return {
            type: 'Identifier',
            name: name
        };
    }
    util.literal = function (val) {
        return {
            type: 'Literal',
            value: val
        };
    }

    util.assign = function (left, right) {
        return {
            type: 'AssignmentExpression',
            operator: '=',
            left: left,
            right: right
        }
    }

    util.assignment = function (left, right) {
        return {
            type: 'ExpressionStatement',
            expression: util.assign(left, right)
        };
    }

    util.declassignment = function (left, right) {
        return {
            type: 'VariableDeclaration',
            declarations: [{
                type: 'VariableDeclarator',
                id: left,
                init: right
            }],
            kind: 'var'
        };
    }

    util.membership = function (obj, prop, computed) {
        return {
            type: 'MemberExpression',
            computed: computed,
            object: obj,
            property: prop
        };
    }
    util.call = function (fn, args) {
        return {
            type: 'CallExpression',
            callee: fn,
            arguments: args
        };
    }

    util.binop = function (left, op, right) {
        return {
            type: 'BinaryExpression',
            operator: op,
            left: left,
            right: right
        };
    }

    util.block = function (stmts, needed) {
        return {
            type: 'BlockStatement',
            body: stmts,
            needed: needed // This indicates whether we'll remove it in post processing
        };
    }


    util.sequence = function (exprs) {
        return {
            type: 'SequenceExpression',
            expressions: exprs
        };
    }

    util.set = function (node1, node2) {
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

    util.property = function (node, accessor) {
        return util.membership(node, util.ident(accessor), false);
    }
    
    util.clone = function (node) {
        return JSON.parse(JSON.stringify(node));
    }

    util.canonAssignment = function (expr) {
        var operator = expr.operator;
        switch (expr.type) { 
            case 'UpdateExpression':
                // This is not completely correct as it does not preserve
                // effect order. i++ should be generated to (i = i + 1, i - 1).
                var op = operator === '++' ? '+' : '-';
                return util.assign(expr.argument, util.binop(util.clone(expr.argument), op, util.literal(1)));

            case 'AssignmentExpression':
                if (operator === '=') {
                    return expr;
                }

                // Extract op from 'op=' style assignments.
                var op = operator.substring(0, operator.indexOf('='));
                return util.assign(expr.left, util.binop(util.clone(expr.left), op, expr.right));

            default:
                return null;
        }
    }

    return util;
})()


