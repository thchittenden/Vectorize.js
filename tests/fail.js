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

tests.push({
    name: 'Cross Iteration Dependency',
    args: [0, 1, 2, 3, 4, 5, 6, 7],
    fn: function fn (args) {
        // Need to cache the result of args.length because otherwise this
        // will infinite loop if we compile wrong because we'll constantly be
        // extending the end of the array! Teehee.
        var iters = args.length;
        for (var i = 0; i < iters; i++) {
            args[i+1] = 2*args[i]; 
        }
        return args;
    }
});

tests.push({
    name: 'Live-Out Dependency',
    args: [0, 1, 2, 3, 4, 5, 6, 7],
    fn: function fn (args) {
        var x;
        for (var i = 0; i < args.length; i++) {
            x = args[i];
        }
        return x;
    }
});

tests.push({
    name: 'Reduction', 
    args: [0, 1, 2, 3, 4, 5, 6, 7],
    fn: function fn (args) {
        var sum = 0;
        for (var i = 0; i < args.length; i++) {
            sum += args[i];
        }
        return sum;
    }
});
