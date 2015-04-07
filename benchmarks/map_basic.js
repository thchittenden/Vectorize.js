benchmarks.push({
    name: 'Map 2x',
    args: new Array(100000).fill(1),
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            args[i] = 2*args[i];
        }   
        return args;
    },
    simdfn: function fn (args) {
        for (var i = 0; i < args.length; i += 4) {
            var tmp = SIMD.float32x4(args[i], args[i+1], args[i+2], args[i+3]);
            tmp = SIMD.float32x4.mul(tmp, SIMD.float32x4.splat(2));
            args[i] = tmp.x;
            args[i+1] = tmp.y;
            args[i+2] = tmp.z;
            args[i+3] = tmp.w;
        }
        return args;
    }   
});

benchmarks.push({
    name: 'Map Inner Loop IV',
    args: new Array(10000).fill(1),
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            var tmp = args[i];
            for (var j = 0; j < 1000; j++) {
                tmp += j;
            }
            args[i] = tmp;
        }
        return args;
    },
    simdfn: function fn (args) {
        for (var i = 0; i < args.length; i += 4) {
            var tmp = SIMD.float32x4(args[i], args[i+1], args[i+2], args[i+3]);
            for (var j = 0; j < 1000; j++) {
                tmp = SIMD.float32x4.add(tmp, SIMD.float32x4.splat(j));
            }
            args[i] = tmp.x;
            args[i+1] = tmp.y;
            args[i+2] = tmp.z;
            args[i+3] = tmp.w;
        }
        return args;
    }
});

benchmarks.push({
    name: 'Map Inner Loop Constant',
    args: new Array(10000).fill(1),
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            for (var j = 0; j < 1000; j++) {
                args[i] += 1;
            }
        }
        return args;
    },
    simdfn: function fn (args) {
        for (var i = 0; i < args.length; i += 4) {
            var tmp = SIMD.float32x4(args[i], args[i+1], args[i+2], args[i+3]);
            for (var j = 0; j < 1000; j++) {
                tmp = SIMD.float32x4.add(tmp, SIMD.float32x4.splat(1));
            }
            args[i] = tmp.x;
            args[i+1] = tmp.y;
            args[i+2] = tmp.z;
            args[i+3] = tmp.w;
        }
        return args;
    }
});
