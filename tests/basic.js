QUnit.test("basic test", function(assert) {
    start = performance.now();
    var sum = 0;
    for (var i = 0; i < 1000; i++) {
        sum += i;
    }
    end = performance.now();
    assert.ok(sum == sum, "Passed! " + ((end - start)/1000) + " ms");
});
