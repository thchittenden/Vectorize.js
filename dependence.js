dependence = (function() {
    var dependence = {};

    function mkStepFn (ast, iv) {
        var update;
        esrecurse.visit(ast, {
            ForStatement: function(node) {  
                update = node.update;
            }
        });
        // Canonicalized form of update
        var canon = util.canonAssignment(update);
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

