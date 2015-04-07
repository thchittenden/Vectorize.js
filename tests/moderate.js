tests.push({
    name: 'Nested Loops Constant',
    args: [0, 1, 2, 3, 4, 5, 6, 7],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            for (var j = 0; j < 100; j++) {
                args[i] += 3;
            }
        }
        return args;
    }
});

tests.push({
    name: 'Nested Loops IV2',
    args: [0, 1, 2, 3, 4, 5, 6, 7],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            for (var j = 0; j < 100; j++) {
                args[i] += j;
            }
        }
        return args;
    }
});

tests.push({
    name: 'Benchmark Test Nested Loops IV',
    args: new Array(100),
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            var tmp = args[i];
            for (var j = 0; j < 1000; j++) {
                tmp += j;
            }
            args[i] = tmp;
        }
        return args;
    }
});

tests.push({
    name: 'Benchmark Test Nested Loops Constant',
    args: new Array(100),
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            var tmp = args[i];
            for (var j = 0; j < 1000; j++) {
                tmp += 1;
            }
            args[i] = tmp;
        }
        return args;
    }
});
