benchmarks.push({
    name: 'Map 2x',
    args: function args () {
        var ret = new Array(100000);
        for (var i = 0; i < ret.length; i++) {
            ret[i] = 2;
        }
        return ret;
    },
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            args[i] = 2*args[i];
        }   
    }
});
