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

        return { Scale: factors.factors[iv], Offset: factors.constant };
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
        };
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
        };
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
                break;
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
                if (dep === null) {
                    return null;
                }
                return dep.IsDep && 
                    (dep.Dist !== 0) &&
                    (Math.abs(dep.Dist) < util.VEC_SIZE);
            }

            return false;
        };

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
        };

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

    // Implementation of Tarjan's SCC algorithm 
    function findSCCs(N, E) {
        var index = 0; 
        var S = [];
        var sccs = [];

        var nodeInfo = [];

        for (var i = 0; i < N.length; i++) {
            nodeInfo.push({
                index : null,
                lowlink : null,
                onStack : false
            });
        }

        var strongconnect = function(v) {
            nodeInfo[v].index = index;
            nodeInfo[v].lowlink = index;
            index++;
            S.push(v);
            nodeInfo[v].onStack = true;

            for (var w = 0; w < N.length; w++) {
                if (!E[v][w]) {
                    continue;
                }

                // Haven't visited w yet.
                var wlink, vlink;
                if (nodeInfo[w].index === null) {
                    strongconnect(w);
                    wlink = nodeInfo[w].lowlink;
                    vlink = nodeInfo[v].lowlink;
                    nodeInfo[v].lowlink = Math.min(wlink, vlink);
                // w is in the current SCC
                } else if (nodeInfo[w].onStack) {
                    wlink = nodeInfo[w].lowlink;
                    vlink = nodeInfo[v].lowlink;
                    nodeInfo[v].lowlink = Math.min(wlink, vlink);
                }
            }

            if (nodeInfo[v].lowlink === nodeInfo[v].index) {
                var scc = [];
                while (S.length > 0) {
                    w = S.pop();
                    scc.push(w);
                    nodeInfo[w].onStack = false;
                    if (w === v) {
                        break;
                    }
                }
                sccs.push(scc);
            }
        };

        for (var v = 0; v < N.length; v++) {
            if (nodeInfo[v].index === null) {
                strongconnect(v);
            }
        }
        return sccs;
    }

    function mkDepGr (loop) {
        var nodes = getAssgns(loop); 
        var edges = [];
        for (var i = 0; i < nodes.length; i++) {
            edges.push(_.map(nodes, function (node, nodeIdx) {
                return determineDependence(nodes[i], node);
            }));
        }
        // Remove any edges that are not loop carried between arrays and
        // scalars.
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].left.type !== 'MemberExpression') {
                continue;
            }

            for (var j = 0; j < i; j++) {
                if (nodes[j].left.type === 'Identifier') {
                    edges[i][j] = false;
                }
            }
        }
        return {
            nodes: nodes,
            edges: edges
        };
    }

    dependence.mkReductions = function (loop, iv) {
        if (!basicFilters(loop)) {
            console.log('failed filters');
            //return null; 
        }
        var g = mkDepGr(loop);
        var sccs = findSCCs(g.nodes, g.edges); 
        console.log(g);
        console.log(sccs);

        // Make sure that arrays have no dependences.
        for (var i = 0; i < g.nodes.length; i++) {
            if (g.nodes[i].left.type === 'MemberExpression' && _.any(g.edges[i])) {
                return null;
            }
        }

        var opClasses = [['+', '-'], ['/', '*']];
        var nodeToLhs = function (n) { return g.nodes[n].left; };
        var nodeToRhs = function (n) { return g.nodes[n].right; };
        var getOpClass = function (op) { 
            var cls =  _.find(opClasses, _.partial(_.contains, _, op));
            return cls === undefined ? null : cls;
        };

        // Make sure that everything in a SCC is always used with the same
        // operator.
        var getReductionOp = function (scc, expr) {
            // Whether an identifer is the lhs of a node in an scc.
            var isSCCNode = function (node) {
                var eq = function (v) { return util.astEq(node, nodeToLhs(v)); };
                return _.any(scc, eq);
            };

            // Whether a given expression eventually has a SCC node for a leaf.
            var reachesSCC = function (n) {
                var reaches = false; 
                esrecurse.visit(n, {
                    Identifier: function (ident) { 
                        if (isSCCNode(ident)) {
                            reaches = true;
                        }
                    }
                });
                return reaches;
            };

            var op = null;
            var safe = true;
            esrecurse.visit(expr, {
                // TODO: Make sure no unary operators use SCCNodes.
                BinaryExpression: function (bin) {
                    var reachSCC = reachesSCC(bin.left) || reachesSCC(bin.right);
                    if (reachSCC && op === null) {
                        op = bin.operator;
                    }

                    // Uses a bin op we don't support.
                    if (reachSCC && getOpClass(bin.operator) === null) {
                        safe = false; 
                        return;
                    }

                    if (reachSCC && (getOpClass(bin.operator) !== getOpClass(op))) {
                        safe = false;
                        return;
                    }
                }
            });

            return { safe : safe, op : op };
        };

        // For now we only accept reductions which are self contained. Meaning
        // non trivial SCC's can only have edges within the SCC.
        var isTrivial = function (scc) {
            return scc.length === 1 && (!g.edges[scc[0]][scc[0]]);
        };

        var getSCC = function (v) {
            return _.find(sccs, _.partial(_.contains, _, v));
        };
        // Returns true if the edges of a trivial node are 'safe'.
        var hasSafeEdges = function (v) {
            // If the edge doesn't exist or it's to a trivial node then it's safe.
            return _.all(_.map(g.edges[v], function (isEdge, n) {
                return (!isEdge) || isTrivial(getSCC(n));
            }));
        };
        var selfContained = function (scc) {
            return _.all(scc, function (v) {
                return _.all(_.map(g.edges[v], function (isEdge, n) {
                    return (!isEdge) || _.contains(scc, n);
                }));
            });
        };

        for (var i = 0; i < sccs.length; i++) { 
            // Arrays are already verified.
            if (nodeToLhs(sccs[i][0]).type === 'MemberExpression') {
                continue;
            }

            // Make sure trivial nodes are 'safe'.
            if (isTrivial(sccs[i])) {
                if (!hasSafeEdges(sccs[i][0])) {
                    console.log('Trivial node has unsafe edges');
                    return null;
                }
                continue;
            } 

            // Make sure that SCC's only have self contained edges.
            if (!selfContained(sccs[i])) { 
                console.log('Reduction is not self contained.');
                return null;
            }
        }
        
        
        var reductions = [];
        for (var i = 0; i < sccs.length; i++) { 
            // If the scc is an array then it's not a reduction so we don't
            // care.
            if (nodeToLhs(sccs[i][0]).type === 'MemberExpression') {
                continue;
            }

            var opClass = null;
            for (var j = 0; j < sccs[i].length; j++) {
                // If the expression by itself uses mixed operations on
                // reduction variables, then the loop is not safe.
                var exprOp = getReductionOp(sccs[i], nodeToRhs(sccs[i][j]));
                if (exprOp.safe === false) {
                    console.log('Reduction expression is unsafe');
                    return null;
                }
                
                if (opClass === null) {         
                    opClass = getOpClass(exprOp.op);
                // If this node uses a different operation then the other nodes
                // then the reduction is not safe.
                } else if (opClass !== getOpClass(exprOp.op)) {
                    console.log('Reduction mixes operations');
                    return null;
                }
                reductions.push({ node: g.nodes[sccs[i][j]], op : exprOp.op });
            }
        }

        console.log(reductions);

        return reductions;
    };

    dependence.detectIV = function (loop) {
        // This should be more robust...
        var name;
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
    };

    return dependence;
})();
