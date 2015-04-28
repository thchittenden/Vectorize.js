util = (function(){
    var esrecurse = require('esrecurse');
    var util = {};
    util.VEC_SIZE = 4;

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
    util.isNumeric = function(i) {
        return (typeof i) === 'number';
    }

    util.isInt = function(i) {
        return Math.round(i) === i;
    }

    util.astEq = function(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    util.canonAssignment = function (expr, mode) {
        var operator = expr.operator;
        switch (expr.type) {
            case 'UpdateExpression':
                var op  = operator === '++' ? '+' : '-';
                var rop = operator === '++' ? '-' : '+';

                if (mode !== 'strict' || expr.prefix) {
                    // The easy case, just return (expr = expr + 1).
                    return util.assign(expr.argument, util.binop(util.clone(expr.argument), op, util.literal(1)));
                } else {
                    // The hard case, return (expr = expr + 1, expr - 1).
                    var inc = util.assign(expr.argument, util.binop(util.clone(expr.argument), op, util.literal(1)));
                    var dec = util.binop(util.clone(expr.argument), rop, util.literal(1));
                    return util.sequence([inc, dec]);
                }

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

    // Gets the factors on all terms in an expression. If the expression cannot
    // be reduced to a polynomial this function will return null.
    util.getFactors = function (ast) {
        
        var validTypes = ["Literal", "Identifier", "BinaryExpression", "UnaryExpression"];
        if (validTypes.indexOf(ast.type) == -1) {
            // Invalid root type.
            return null;
        }
       
        function add(a, b) { return a + b }
        function sub(a, b) { return a - b }
        function merge(lfactors, rfactors, op) {
            var out = {};
            for (elem in lfactors) {
                if (elem in rfactors) {
                    out[elem] = op(lfactors[elem], rfactors[elem]);       
                } else {
                    out[elem] = lfactors[elem];
                }
            }
            for (elem in rfactors) {
                if (elem in lfactors) {
                    // Already accounted for.
                } else {
                    out[elem] = rfactors[elem];
                }
            }
            return out;
        }
        function isempty(obj) {
            for (x in obj) {
                return false;
            }
            return true;
        }

        var valid = true;
        var factors = {};
        var constant = 0;
        esrecurse.visit(ast, {
            Literal: function (node) {
                constant = node.value;
            },
            Identifier: function (node) {
                factors[node.name] = 1;
            },
            BinaryExpression: function (node) {
                if (validTypes.indexOf(node.left.type) == -1) valid = false;
                if (validTypes.indexOf(node.right.type) == -1) valid = false;
                
                this.visit(node.left);
                var lfactors = factors;
                var lconstant = constant;
                factors = {};
                constant = 0;
                
                this.visit(node.right);
                var rfactors = factors;
                var rconstant = constant;
                factors = {};
                constant = 0;

                // Combine the left and right factors.
                switch (node.operator) {
                    case '+': {
                        // Add all factors and constants.
                        factors = merge(lfactors, rfactors, add);
                        constant = lconstant + rconstant;
                        break;
                    }
                    case '-': {
                        // Subtract all factors and constants.
                        factors = merge(lfactors, rfactors, sub);
                        constant = lconstant - rconstant;
                        break;
                    }
                    case '/': {
                        // We may only divide by constants.
                        if (!isempty(rfactors)) {
                            valid = false;
                        } else {
                            for (elem in lfactors) {
                                factors[elem] = lfactors[elem] / rconstant;
                            }
                            constant = lconstant / rconstant;
                        }
                        break;
                    }
                    case '*': {
                        if (!isempty(lfactors) && !isempty(rfactors)) {
                            // This would result in quadratic terms...
                            valid = false;
                        } else if (!isempty(lfactors)) {
                            for (elem in lfactors) {
                                factors[elem] = lfactors[elem] * rconstant;
                            }
                        } else if (!isempty(rfactors)) {
                            for (elem in rfactors) {
                                factors[elem] = rfactors[elem] * lconstant;
                            }
                        }
                        constant = lconstant * rconstant;
                        break;
                    }
                    default: {
                        // We don't support ==, !=, <<, ^, etc...
                        valid = false;
                    }
                }
            },
            UnaryExpression: function (node) {
                
                this.visit(node.argument);

                switch(node.operator) {
                    case '-': {
                        for (elem in factors) {
                            factors[elem] = -factors[elem];
                        }
                        constant = -constant;
                        break;
                    }
                    default: {
                        // We don't support !, ~, etc...
                        valid = false;
                    }
                }
            }
        });

        if (valid) {
            return { factors: factors, constant: constant }
        } else {
            return null;
        }

    }

    util.canonExpression = function (expr) {
       
        function canonicalize(node) {
            var factors = util.getFactors(node);
            var ret = null;
            for (elem in factors.factors) {
                if (ret === null) {
                    // First iteration.
                    ret = util.ident(elem);
                    if (factors.factors[elem] != 1) {
                        ret = util.binop(util.literal(factors.factors[elem]), '*', ret);
                    }
                } else {
                    if (factors.factors[elem] != 1) {
                        ret = util.binop(util.binop(util.literal(factors.factors[elem]), '*', util.ident(elem)), '+', ret);
                    } else {
                        ret = util.binop(util.ident(elem), '+', ret);
                    }
                }
            }
            if (factors.constant !== 0) {
                ret = util.binop(ret, '+', util.literal(factors.constant));
            }
            return ret;
        }

        esrecurse.visit(expr, {
            BinaryExpression: function (node) {
                util.set(node, canonicalize(node)); 
            },
            UnaryExpression: function (node) {
                util.set(node, canonicalize(node));
            }
        });
        return expr;
    }

    return util;
})()
