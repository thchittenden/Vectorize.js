dependence = (function() {
    var dependence = {};

    function clone (x) {
        return JSON.parse(JSON.stringify(x));
    }

    function getIVFactors(ast, iv) {
        var validTypes = ["Literal", "Identifier", "BinaryExpression"];
        if (validTypes.indexOf(ast) == -1) {
            // Invalid root type.
            return null;
        }

        var valid = true;
        var retprod;
        var retsum;
        esrecurse.visit(ast, {
            Literal: function (node) {
                retprod = 0;
                retsum = node.value; 
            },
            Identifier: function (node) {
                if (node.name === iv.name) {
                    retprod = 1;
                    retsum = 0;
                } else {
                    valid = false;
                }
            },
            BinaryExpression: function (node) {
                if (validTypes.indexOf(node.left.type) == -1) valid = false;
                if (validTypes.indexOf(node.right.type) == -1) valid = false;
                this.visit(node.left);
                var lprod = retprod;
                var lsum = retsum;
                this.visit(node.right);
                var rprod = retprod;
                var rsum = retsum;

                // Combine the left and right factors.
                switch (node.operator) {
                    case '+': {
                        // a*i + b + c*i + d = (a + c)*i + (b + d)
                        retprod = lprod + rprod;
                        retsum = lsum + rsum;
                    }
                    case '-': {
                        // a*i + b - (c*i + d) = (a - c)*i + (b - d)
                        retprod = lprod - rprod;
                        retsum = lsum - rsum;
                    }
                    case '/': {
                        // (a*i + b) / c = (a/c)*i + b/c
                        if (rprod != 0) {
                            valid = false;
                        } else {
                            retprod = lprod / rsum;
                            retsum = lsum / rsum;
                        }
                    }
                    case '*': {
                        if (lprod != 0 && rprod != 0) {
                            // (a*i + b) * (c*i + d) = a*c*i^2... 
                            // Dependency analysis cannot handle quadratic terms.
                            valid = false;
                        } else if (lprod != 0) {
                            // (a*i + b) * c = a*c*i + b*c
                            retprod = lprod * rsum;
                            retsun = lsum * rsum;
                        } else {
                            // a * (b*i + c) = a*b*i + a*c
                            retprod = rprod * lsum;
                            retsum = lsum * rsum;
                        }
                    }
                    default: {
                        // We don't support ==, !=, <<, ^, etc...
                        valid = false;
                    }
                }
            }
        });

        if (valid) {
            return { k: retprod, c: retsum };
        } else {
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

