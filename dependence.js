dependence = (function() {
    var estraverse = require('estraverse');
    var esrecurse = require('esrecurse');
    var _ = require('underscore');
    
    var dependence = {};

    function getIVFactors(expr, iv) {
        // Get the factors in the polynomial and make sure there is only an IV
        // term.
        var factors = util.getFactors(expr);
        for (var elem in factors) {
            if (elem != iv) {
                return null;
            }
        }

        return { Scale: factors.factors[iv], Offset: factors.constant }
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

            var stepped = estraverse.replace(util.clone(canon.right), {
                leave: function(node) {
                    if (node.type === 'Identifier' &&
                        node.name === canon.left.name) {
                        return step(i -1);
                    }
                }
            });

            return util.canonExpression(stepped);
        }
        return step;
    }

    function linearEqElems(idx) {
        // Forces Literal constants to the right of binary exressions.
        var forceConstRight = function(expr) {
            return estraverse.replace(util.clone(expr), {
                leave: function(node) {
                    var commOps = ['+', '*'];
                    if (node.type == 'BinaryExpression' &&
                        (commOps.indexOf(node.operator) !== -1) &&
                        node.left.type ==  'Literal') {
                        return util.binop(node.right, node.op, node.left);
                    }
                }
            });
        }
        idx = forceConstRight(idx);
        switch (idx.type) {
            case 'Literal':
                // a[c] case
                return util.isNumeric(idx.value) ? {
                    Type: 'Constant',
                    Value: idx.value
                } : null;
            case 'Identifier':
                // a[i] case
                return {
                    Type: 'Equation',
                    Scale: 1,
                    Offset: 0,
                    Literal: idx.name
                };
            case 'BinaryExpression':
                // a[i * 5]
                if (idx.operator === '*' && idx.right.type === 'Literal') {
                    return util.isNumeric(idx.right.value) ? {
                        Type: 'Equation',
                        Scale: idx.right.value,
                        Offset: 0,
                        Literal: idx.left.name
                    } : null;
                }

                // a[i + 5]
                if (idx.operator === '+' &&
                    idx.left.type === 'Identifier' &&
                    idx.right.type === 'Literal') {
                    return util.isNumeric(idx.right.value) ? {
                        Type: 'Equation',
                        Scale: 1,
                        Offset: idx.right.value,
                        Literal: idx.left.name
                    } : null;
                }

                // a[ (i * c) + b ]
                if (idx.operator === '+' && idx.right.type === 'Literal' &&
                    idx.left.type === 'BinaryExpression' &&
                    idx.left.left.type === 'Identifier' &&
                    idx.left.right.type === 'Literal') {
                    var scale = idx.left.right.value;
                    var offset = idx.right.value;
                    var literal = idx.left.left.name;
                    return util.isNumeric(scale) && util.isNumeric(offset) ? {
                        Type: 'Equation',
                        Scale: scale,
                        Offset: offset,
                        Literal: literal
                    } : null;
                }
            default:
                break;
        }
        return null;
    }

    function lamport(a, b) {
        if (a.type === 'Identifier' && b.type === 'Identifier' && a.name === b.name) {
            return {
                IsDep: true,
                Dist: 0
            };
        }

        if (a.type !== 'MemberExpression' || b.type !== 'MemberExpression') {
            return null;
        }

        // Both are array access
        var aInfo = getIVFactors(a.property);
        console.log(aInfo);
        var bInfo = getIVFactors(b.property);

        if (aInfo === null || bInfo === null) {
            return null;
        }

        if (aInfo.Scale !== bInfo.Scale) {
            return null;
        }

        var dist = (aInfo.Offset - bInfo.Offset) / a.Scale;
        if (!util.isInt(dist)) {
            return {
                IsDep: false,
                Dist: -1
            };
        }

        return {
            IsDep: true,
            Dist: dist
        };
    }

    // Return scalar and member expressions within some expression.
    function getUses (expr) {
        var uses = [];
        estraverse.traverse(expr, {
            enter: function (node) {
                if (node.type == 'MemberExpression') {
                    uses.push(node);
                    this.skip();
                } else if (node.type == 'Identifier') {
                    uses.push(node);
                }
            }
        });

        return uses;
    }

    // Extracts the right hand side from an assignment  variable declaration.
    function canonAssgnExpr(expr) {
        if (expr.type === 'AssignmentExpression') {
            return expr;
        }
        return {
            left: expr.id,
            right: expr.init
        };
    }
    
    // Returns all expressions of the form
    function getAssgns(loop) {
        var assgns = [];
        esrecurse.visit(loop.body, {
            AssignmentExpression: function (assgn) {
                assgns.push(util.canonAssignment(assgn));
            },
            VariableDeclaration: function (decl) {
                for (var i = 0; i < decl.declarations.length; i++) {
                    assgns.push(canonAssgnExpr(decl.declarations[i]));
                }
            }
        });
        return assgns;
    }

    // Whether assgn1 uses any variables which assgn0 defines.
    function determineDependence (assgn0, assgn1) {
        var checkDep = function(e1, e2) {
            if (e1.type !== e2.type) {
                return false;
            }

            if (e1.type === 'Identifier') {
                return util.astEq(e1, e2);
            }

            if (util.astEq(e1.object, e2.object)) {
                var dep = lamport(e1.property, e2.property);
                // Can't handle this case.
                if (dep == null) {
                    return null;
                }
                return dep.IsDep && 
                    (dep.Dist != 0) &&
                    (Math.abs(dep.Dist) < util.VEC_SIZE);
            }

            return false;
        }

        // Checks if assgn1 uses the variables defined by assgn0.
        var hasDep = _.any(_.map(getUses(assgn1.right), function(v) { 
            return checkDep(assgn0.left, v); 
        }));

        return hasDep;
    }

    // Filters out thing's we can't handle right now. I.e two dimm arrays and
    // objects.
    function basicFilters (loop, iv) {
        var valid_idx = function (idx) {
            var valid_exprs = ['BinaryExpression', 'Literal', 'Identifier'];
            var is_valid = true;
            estraverse.traverse(idx, {
                enter: function (node) {
                    if (!_.contains(valid_exprs, node.type)) {
                        console.log("FOUND " + node.type);
                        is_valid = false;
                    }
                }
            });
            return is_valid;
        }

        var allClear = true;
        esrecurse.visit(loop.body, {
            MemberExpression: function (node) {
                if (node.object.type !== 'Identifier') {
                    allClear = false;
                }

                if (!valid_idx(node.property)) {
                    allClear = false;
                }

                if (node.computed === false) {
                    allClear = false;
                }
            }
        });
        return allClear;
    }

    dependence.mkReductions = function (loop, iv) {
        if (!basicFilters(loop)) {
            console.log('failed filters');
            return null; 
        }
        var assgns = getAssgns(loop);
        for (var i = 0; i < assgns.length; i++) {
            for (var j = 0; j < assgns.length; j++) {
                // If there is a loop carried dependence for a scalar then we
                // can't vector it.
                if (assgns[i].left.type == 'Identifier' && j < i) {
                    var dep = determineDependence(assgns[i], assgns[j]);
                    if (dep === true || dep === null) {
                        console.log('loop carried scalar dep');
                        return null;
                    }
                }
                // If there is any dependence for an array then we can't do
                // anything.
                if (assgns[i].left.type == 'MemberExpression') {
                    var dep = determineDependence(assgns[i], assgns[j]);
                    if (dep === true || dep === null) {
                        console.log('Array carried dep');
                        return null;
                    }
                }
            }
        }

        // Look for reductions.
        var reductions = _.filter(assgns, function (assgn) { 
            var eq = _.curry(util.astEq)(assgn.left);
            var uses = getUses(assgn.right);
            return assgn.left.type == 'Identifier' && _.any(uses, eq);
        });
        console.log(reductions);
        return reductions;
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
            throw "could not detect induction variable";
        }

        return {
            name: name,
            step: mkStepFn(loop, name)
        };
    }

    return dependence;
})()
