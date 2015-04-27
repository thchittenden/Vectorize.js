tests = [];
mods.push({
    name: 'Moderate',
    order: 2,
    tests: tests,
});

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

tests.push({
    name: 'Index Update',
    args: { a: [ 1, 2, 3, 4, 5, 6, 7, 8 ], b: [ 0, 0, 1, 1, 4, 4, 5, 5 ] },
    fn: function fn (args) {
        var a = args.a;
        var b = args.b;
        for (var i = 0; i < a.length; i++) {
            var idx = b[i];
            idx = idx + 1;
            a[i] = a[idx];
        }
        return a;
    }

});

tests.push({
    name: 'Vector Uneven Length',
    args: new Array(11).fill(2),
    fn: function fn (args) {
        for (var i = 0; i < args.length; i++) {
            args[i] = args[i] + 1;
        }
        return args;
    }
});

tests.push({
    name: 'Tricky Index',
    args: new Array(8).fill(2),
    fn: function fn(args) {
        for (var i = 0; i < args.length; i++) {
            var x = 2;
            a[i + x - 2] = 3;
        }
        return args;
    }
});

tests.push({
    name: 'Multiple Reductions',
    args : [],
    fn: function fn (args) {
        var w = 5;
        var z = 10;
        var a = 15;
        var b = 20;
        for (var i = 0; i < args.length; i++) {
            w = z + 2;
            z = w + 5;
            a = b / 20;
            b = a * 15;
        }
        return w + b;
    }
});

tests.push({
    name: 'While',
    args: { arr: new Array(1000).fill(1), e: 100 },
    fn: function fn (args) {
        for (var i = 0; i < args.arr.length; i++) {
            var x = 0; 
            while (x++ < args.e) {
                args.arr[i] += x;
            }
        }
        return args.arr;
    }
});

tests.push({
    name: 'Loop Invariance',
    args: [ 0, 1, 2, 3, 4, 5, 6, 7 ],
    fn: function fn (args) {
        var a = 0;
        var b = [1, 2, 3];
        var c = { i1: 0, i2: 1 };
        var d = [0];
        for (var i = 0; i < args.length; i++) {
            
            var y = b[0]; // LV
            var k = x; // LV
            var r = d[0]; // LV
            d[0] = 2; // LI
            var p = d[0]; // LI
            var x = a; // LI
            b[0] = x; // LI
            var z = b[0] + x; // LI
            var w = c.i1; // LI
            var u = args[c.i2]; // LI
            b[i] = 3; // LV
            var q = b[0]; // LV

            var m = args[i] + u; // LV
            var n = args[0] + w; // LI
            if (m > 0) {
                n = 2; // LI
                u = n; // LI
            } else {
                n = 3; // LI
                u = n; // LI
            }
            // n, u LV

            var l = args[0] + n; // LV
        }
        
        return 0;
    }
});
