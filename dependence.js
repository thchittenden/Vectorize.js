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

    function lamport(a, b, iv) {
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
        var aInfo = getIVFactors(a.property, iv);
        var bInfo = getIVFactors(b.property, iv);

        if (aInfo === null || bInfo === null) {
            // The indexes were not of the form a*i+b
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
    function determineDependence (assgn0, assgn1, iv) {
        var checkDep = function(e1, e2) {
            if (e1.type !== e2.type) {
                return false;
            }

            if (e1.type === 'Identifier') {
                return util.astEq(e1, e2);
            }

            if (util.astEq(e1.object, e2.object)) {
                var dep = lamport(e1.property, e2.property, iv);
                // Lamport's test determines the indexes may clash so this
                // is unsafe.
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

    function mkDepGr (loop, iv) {
        var nodes = getAssgns(loop); 
        var edges = [];
        for (var i = 0; i < nodes.length; i++) {
            edges.push(_.map(nodes, function (node, nodeIdx) {
                return determineDependence(node, nodes[i], iv);
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
        var g = mkDepGr(loop, iv);
        var sccs = findSCCs(g.nodes, g.edges); 
        console.log(g);
        console.log(sccs);
        
        var opClasses = [['+', '-'], ['/', '*']];
        var nodeToLhs = function (n) { return g.nodes[n].left; };
        var nodeToRhs = function (n) { return g.nodes[n].right; };
        var getOpClass = function (op) { 
            var cls =  _.find(opClasses, _.partial(_.contains, _, op));
            return cls === undefined ? null : cls;
        };

        // Make sure that arrays have no dependences.
        for (var i = 0; i < g.nodes.length; i++) {
            if (g.nodes[i].left.type === 'MemberExpression' && _.any(g.edges[i])) {
                var left = escodegen.generate(nodeToLhs(i));
                var ridx = _.find(g.edges[i], _.identity);
                var right = escodegen.generate(nodeToLhs(ridx));
                throw ("invalid dependence between " + left + " and " + right);
            }
        }

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

        // Determines if a node is 'trivial'. We define trivial to mean that 
        // the node is not part of a cycle and does not contain a self edge. In
        // practice this means the node is an assignment where the RHS does not
        // depend on any reduction variables.
        // For now we only accept reductions which are self contained. Meaning
        // non trivial SCC's can only have edges within the SCC.
        var isTrivial = function (scc) {
            return scc.length === 1 && (!g.edges[scc[0]][scc[0]]);
        };

        var getSCC = function (v) {
            return _.find(sccs, _.partial(_.contains, _, v));
        };

        // Determines if all edges on a trivial node are 'safe'. We define safe
        // for trivial nodes to mean they only have edges to other trivial nodes.
        var hasSafeEdges = function (v) {
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
                    throw 'trivial node has unsafe edges';
                }
                continue;
            } 

            // Make sure that SCC's only have self contained edges.
            if (!selfContained(sccs[i])) { 
                throw 'reduction is not self contained.';
            }
        }
        
        
        var reductions = {};
        for (var i = 0; i < sccs.length; i++) { 
            // If the scc is an array then it's not a reduction so we don't
            // care.
            if (nodeToLhs(sccs[i][0]).type === 'MemberExpression' ||
                isTrivial(sccs[i])) {
                continue;
            }

            var opClass = null;
            for (var j = 0; j < sccs[i].length; j++) {
                // If the expression by itself uses mixed operations on
                // reduction variables, then the loop is not safe.
                var exprOp = getReductionOp(sccs[i], nodeToRhs(sccs[i][j]));
                if (exprOp.safe === false) {
                    throw 'reduction operator is unsafe';
                }
                
                if (opClass === null) {         
                    opClass = getOpClass(exprOp.op);
                // If this node uses a different operation then the other nodes
                // then the reduction is not safe.
                } else if (exprOp.op !== null && opClass !== getOpClass(exprOp.op)) {
                    throw 'reduction mixes operations';
                }
            }

            for (var j = 0; j < sccs[i].length; j++) {
                var name = nodeToLhs(sccs[i][j]).name;
                reductions[name] = opClass;
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
