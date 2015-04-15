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
    name: 'Index Arithmetic',
    args: new Array(100).fill(0),
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            var x = i;
            var y = x + 2;
            var z = i * y;
            args[i] = z;
        }
        return args;
    }
});

tests.push({
    name: 'Complex LValue',
    args: new Array(100).fill(0),
    fn: function fn (args) {
        var obj = { prop: args };
        for (var i = 0; i < args.length; i++) {
            obj.prop[i] = 2 * obj.prop[i];
        }
        return obj.prop;
    }
});

tests.push({
    name: 'Nothing-a-do-index',
    args: new Array(100).fill(0),
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            i + 2 - 1;
            args[i] = 4;
        }   
        return args;
    }
});

tests.push({
    name: 'Array Expressions',
    args: [[ 1, 2, 3, 4, 5, 6, 7, 8 ]],
    fn: function fn (args) {
        var i = 0;
        for (var j = 0; j < args[0].length; j++) {
            args[i][j] = args[i][j] + 1;
        }
        return args;
    }
});
