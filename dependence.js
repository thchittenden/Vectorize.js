dependence = (function() {
    var dependence = {};

    // Convert for loop operatation in to a canonical representation.
    function updateToAssgn(expr) {
        var operator = expr.operator;
        switch (expr.type) { 
            case 'UpdateExpression':
                var op = operator === '++' ? '+' : '--';
                return util.assign(expr.argument, util.binop(expr.argument, op, util.literal(1)));

            case 'AssignmentExpression':
                if (operator === '=') {
                    return expr;
                }

                // Extract op from 'op=' style assignments.
                var op = operator.substring(0, operator.indexOf('='));
                return util.assign(expr.left, util.binop(expr.right, op, expr.left));

            default:
                return null;
        }
    }

    function mkStepFn (ast, iv) {
        var update;
        esrecurse.visit(ast, {
            ForStatement: function(node) {  
                update = node.update;
            }
        });
        // Canonicalized form of update
        var canon = updateToAssgn(update);
        var step = function (i) {
            if (i === 0) {
                return util.ident(iv);
            }

            return estraverse.replace(clone(canon.right), {
                leave: function(node) {
                    if (node.type === 'Identifier' &&
                        node.name === canon.left.name) {
                        var prev = step(i - 1);
                        return step(i -1);
                    }
                }
            });
        }
        return step;
    }

    dependence.detectIV = function (loop) {
        // This should be more robust...
        var name = undefined;
        esrecurse.visit(loop.update, {
            UpdateExpression: function (node) {
                name = node.argument.name;
            },
            AssignmentExpression: function (node) {
                name = node.left.name;
            }
        }); 
        if (name === undefined) {
            throw "could not detect induction variable"
        }

        return {
            name: name,
            step: mkStepFn(loop, name)
        };
    }

    return dependence;
})()

