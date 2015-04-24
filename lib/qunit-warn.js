QUnit.testStart(function (details) {
    QUnit.warned = false;
});

QUnit.testDone(function (details) {
    
    if (QUnit.warned) {
        var id = '#qunit-test-output-' + details.testId;
        $(id).addClass('warn');
    }

});

QUnit.extend(QUnit, {
    warn: function () {
        QUnit.warned = true;
    }
});
