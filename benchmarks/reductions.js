benchmarks.push({
    name: 'Sum Reduction',
    args: new Array(1000000).fill(2),
    fn: function fn (args) {
        var sum = 0;
        for (var i = 0; i < args.length; i++) {
            sum += args[i];
        }   
        return sum;
    },
});

benchmarks.push({
    name: 'Times Reduction',
    args: new Array(100000).fill(1.001),
    fn: function fn (args) {
        var prod = 1;
        for (var i = 0; i < args.length; i++) {
            prod *= args[i];
        }
        return prod;
    },
});

