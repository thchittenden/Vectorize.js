#!/usr/local/bin/js
assertEq(isSimdAvaialble(), true);
load('../lib/benchmark.js');

Array.prototype.fill = function (val) {
    for (var i = 0; i < this.length; i++) {
        this[i] = val;
    }  
    return this;
}

function scalar (args, n) {
    for (var i = 0; i < args.length; i++) {
        var tmp = args[i];
        for (var j = 0; j < n; j++) {
            tmp += 1;
        }
        args[i] = tmp;
    }
}

function vector (args, n) {
    for (var i = 0; i < args.length; i += 4) {
        var tmp = SIMD.float32x4(args[i], args[i+1], args[i+2], args[i+3]);
        for (var j = 0; j < n; j++) {
            tmp = SIMD.float32x4.add(tmp, SIMD.float32x4.splat(1));
        }
        args[i] = tmp.x;
        args[i+1] = tmp.y;
        args[i+2] = tmp.z;
        args[i+3] = tmp.w;
    }
}

var samples = [
{ e: 2500, n: 4000 },
{ e: 5000, n: 2000 },
{ e: 10000, n: 1000 },
{ e: 10000, n: 875 },
{ e: 10000, n: 750 },
{ e: 10000, n: 625 },
{ e: 10000, n: 500 },
{ e: 50000, n: 375 },
{ e: 50000, n: 250 },
{ e: 50000, n: 125 },
{ e: 50000, n: 100 },
{ e: 100000, n: 75 },
{ e: 100000, n: 50 },
{ e: 100000, n: 25 },
{ e: 500000, n: 20 },
{ e: 500000, n: 15 },
{ e: 500000, n: 10 },
{ e: 500000, n: 8 },
{ e: 500000, n: 6 },
{ e: 500000, n: 4 },
{ e: 500000, n: 2 },
{ e: 500000, n: 1 },
{ e: 500000, n: 0 } 
];

print('Starting! ' + samples.length + ' samples.');
for (i in samples) {
    var sample = samples[i];
    var arr = new Array(sample.e).fill(0);
    var b1 = new Benchmark(function () { scalar(arr, sample.n) }); b1.run();
    var b2 = new Benchmark(function () { vector(arr, sample.n) }); b2.run();
    print(sample.e + ', ' + sample.n + ', ' + (b1.times.period * 1000) + ', ' + (b2.times.period * 1000));
}
