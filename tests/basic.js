tests.push({
    name: 'Vector Add Literal',
    args: [1, 2, 3, 4, 5, 6, 7, 8],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            args[i] = args[i] + 1;
        }
        return args;
    }
});

tests.push({
    name: 'Vector Add Identifier',
    args: [1, 2, 3, 4, 5, 6, 7, 8],
    fn: function fn (args) {
        var x = 2;
        for (var i = 0; i < args.length; i++) {
            args[i] = args[i] + x;
        }
        return args;
    }
});

tests.push({
    name: 'Vector Add Vector',
    args: { arg1: [0, 1, 2, 3], arg2: [4, 5, 6, 7] },
    fn: function fn (args) {
        var a = args.arg1;
        var b = args.arg2;
        var c = [];
        for (var i = 0; i < a.length; i++) {
             c[i] = a[i] + b[i];
        }
        return args;
    }
});

tests.push({
    name: 'Assignment Foo',
    args: [1, 2, 3, 4, 5, 6, 7, 8],
    fn: function fn (args) {
        
        for (var i = 0; i < args.length; i++) {
            var x = args[i];
            var y = x + 2;
            var z = y + args[i];
            args[i] = z;
        }
        return args;

    }
});

tests.push({
    name: 'Assignment Ops',
    args: [1, 2, 3, 4, 5, 6, 7, 8],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            args[i] += 3;
            args[i] -= 2;
            args[i] *= 4;
            args[i] /= 2;
        }   
        return args;
    }
});

tests.push({
    name: 'Recursive Index',
    args: { args1: [0, 0, 7, 7, 4, 4, 0, 0], args2: [ 1, 2, 3, 4, 5, 6, 7, 8 ] },
    fn: function fn (args) {
        var a = args.arg1;
        var b = args.arg2;
        var c = [];
        for (var i = 0; i < args.length; i++) {
            c[i] = b[a[i]];
        }
        return c;
    }
});

tests.push({
    name: 'Recursive Index Op',
    args: { args1: [0, 0, 6, 6, 4, 4, 0, 0], args2: [ 1, 2, 3, 4, 5, 6, 7, 8 ] },
    fn: function fn (args) {
        var a = args.arg1;
        var b = args.arg2;
        var c = [];
        for (var i = 0; i < args.length; i++) {
            c[i] = b[a[i] + 1];
        }
        return c;
    }
});

tests.push({
    name: 'Recursive Index Op Var',
    args: { args1: [0, 0, 2, 2, 4, 4, 0, 0], args2: [ 1, 2, 3, 4, 5, 6, 7, 8 ] },
    fn: function fn (args) {
        var a = args.arg1;
        var b = args.arg2;
        var c = [];
        for (var i = 0; i < args.length; i++) {
            var x = 3;
            c[i] = b[a[i] + x];
        }
        return c;
    }
});

tests.push({
    // This likely cannot be supported since we won't be able to determine
    // dependencies, but we might as well be able to do it!
    name: 'Recursive Index Assign',
    args: { args1: [1, 0, 4, 7, 5, 6, 3, 2], args2: [ 1, 2, 3, 4, 5, 6, 7, 8 ] },
    fn: function fn (args) {
        var a = args.arg1;
        var b = args.arg2;
        var c = [];
        for (var i = 0; i < args.length; i++) {
            c[a[i]] = b[i];
        }
        return c;
    }
});

tests.push({
    name: 'Assignment Foo Two',
    args: [ 1, 2, 3, 4, 5, 6, 7, 8 ],
    fn: function fn (args) {
        var x;
        for (var i = 0; i < args.length; i++) {
            x = args[i];
            args[i] = x + 2;
        }
    }
});

tests.push({
    name: 'Hidden Assignment',
    args: [ 1, 2, 3, 4, 5, 6, 7, 8 ],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            var x = args[i];
            var y = (x = 2, args[i]);
            args[i] = x + 1;
        }
        return args;
    }
});

tests.push({
    name: 'Sequences',
    args: [ 1, 2, 3, 4, 5, 6, 7, 8 ],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            var x = (args[i] = 3, y = 2, 4);
            args[i] = x;
            x = (args[i] = (args[i] = 3) + 2);
            args[i] = x; // Should be 5.
        }
        return args;
    }
});

tests.push({
    name: 'IV != i',
    args: [ 1, 2, 3, 4, 5, 6, 7, 8 ],
    fn: function fn (args) {
        for (var j = 0; j < args.length; j++) {
            args[j] = args[j] + 1;
        }
        return args;
    }
});

tests.push({
    name: 'Update Foo',
    args: [ 1, 2, 3, 4, 5, 6, 7, 8 ],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            var x = 0;
            args[i] += x++;
            args[i] += ++x;
            args[i] += x--;
            args[i] += --x;
        }
        return args;
    }
});

tests.push({
    name: 'Update Foo Two',
    args: [ 1, 2, 3, 4, 5, 6, 7, 8 ],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            args[i]++;
            args[i]--;
            ++args[i];
            --args[i];

            // The identity function would be too boring.
            args[i]++;
        }
        return args;
    }
});
