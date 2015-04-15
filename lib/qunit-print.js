QUnit.testStart(function (details) {
    QUnit.messages = "";   
});

QUnit.testDone(function (details) {
    if (QUnit.messages === "") {
        // No messages.
        return;
    }

    var id = '#qunit-test-output-' + details.testId;

    // Add our messages.
    $(id).append("<div class='qunit-messages'>" + QUnit.messages + "</div>");
    
    // If there were no failures, start out hidden.
    if (details.failed === 0) {
        $(id + ' > .qunit-messages').addClass('qunit-collapsed');
    }

    // When the title is clicked, toggle the collapsed class.
    $(id + ' > strong').click(function (ev) { 
        $(id + ' > .qunit-messages').toggleClass('qunit-collapsed') 
    });
   
    // Pretty print the new code.
    prettyPrint();
});

QUnit.extend (QUnit, {
    print: function (msg) {
        QUnit.messages += msg;
    }
});
