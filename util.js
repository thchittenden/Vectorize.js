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

    util.block = function (stmts) {
        return {
            type: 'BlockStatement',
            body: stmts
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

    return util;
})()

