benchmarks.push({
    name: 'Map 2x',
    args: new Array(100000),
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            args[i] = 2*args[i];
        }   
    }
});
