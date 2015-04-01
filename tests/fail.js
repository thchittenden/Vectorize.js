// These are tests known to fail!

tests.push({
    name: 'Vector Length 9',
    args: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            args[i] = args[i] + 1;
        }
        return args;
    }
});

tests.push({
    name: 'Index Trouble',
    args: [0, 0, 0, 0, 0, 0, 0, 0],
    fn: function fn (args) {
        for (var i = 0; i < args.length/2; i++) {
            args[2*i] = 3;
            args[i*2] = 4; // This will override the 2*i index.
            args[2*i] = 5;
        }
        return args;
    }
});

tests.push({
    name: 'Assignment Trouble',
    args: [0, 0, 0, 0, 0, 0, 0, 0],
    fn: function fn (args) {
        for (var i = 0; i < args.length/2; i++) {
            args[i*2] = 1;
            var x = args[2*i]; // This will read 0.
            args[2*i] = x + 1;
        }
        return args;
    }

});
