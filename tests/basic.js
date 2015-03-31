tests.push({
    name: 'Vector Add Literal',
    args: [0, 1, 2, 3, 4, 5, 6, 7],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            args[i] = args[i] + 1;
        }
        return args;
    }
});

tests.push({
    name: 'Vector Add Identifier',
    args: [0, 1, 2, 3, 4, 5, 6, 7],
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
    }
});
