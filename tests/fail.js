// These are tests known to fail!
tests = [];
mods.push({
    name: 'Hard',
    order: 100, // Perform these last.
    tests: tests,
});

tests.push({
    name: 'Read Placement',
    args: { a: [ 1, 2, 3, 4, 5, 6, 7, 8 ], b: [ 0, 0, 1, 1, 4, 4, 5, 5 ] },
    fn: function fn (args) {
        var a = args.a;
        var b = args.b;
        for (var i = 0; i < a.length; i++) {
            var x = b[i];
            x++;
            for (var j = 0; j < 10; j++) {
                a[x] += 1;
            }
        }
        return a;
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

tests.push({
    name: 'Deep Reduction',
    args: [0, 1, 2, 3, 4, 5, 6, 7],
    fn: function fn (args) {
        var x, y, z = 0, sum = 0;
        for (var i = 0; i < args.length; i++) {
            sum = z + args[i];
            x = sum;
            y = x;
            z = y;
        }
        return sum;
    }
});

tests.push({
    name: 'Scan',
    args: new Array(8).fill(1),
    fn: function fn (args) {
        var scan = [0];
        for (var i = 0; i < args.length; i++) {
            scan[i + 1] = scan[i] + args[i];
        }
        return scan;
    }
});

tests.push({
    name: 'Inner Loop Iterations',
    args: [0, 1, 2, 3, 4, 5, 6, 7],
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            for (var j = 0; j < i; j++) {
                args[i] += j;
            }
        } 
        return args;
    }   
});

tests.push({
    name: 'Mixed Op Reduction',
    args: [],
    fn: function fn (args) {
        var w = 5;
        var y = 60;
        var z = 15;
        for (var i = 0; i < 667; i++) {
            w = y * 5;
            z = 20 / y;
            y = z + w;
        }
        return z;
    }
});

tests.push({
    name: 'Mixed Reduction',
    args: [],
    fn: function fn (args) {
        var w = 5;
        var y = 60;
        var z = 15;
        var a = 20;
        var b = 67;
        for (var i = 0; i < 157; i++) {
            w = z + y + 2 + i;
            z = y - 20;
            y = z + 15;
            a = b + 20 / z;
            b = a - 15;
        }
        return y + z - a;
    }
});

