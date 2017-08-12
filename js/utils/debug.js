function checkParentNodeInconsistency(h, u) {
    'use strict';

    var error = null;
    var promise = new MegaPromise();

    if (!M.d[h]) {
        error = 'The node does not exists ' + h;
    }
    else if (!M.d[h].t) {
        error = 'The node is not a folder ' + h;
    }
    else if (!fmdb) {
        error = 'No fmdb.';
    }
    else {
        fmdb.getbykey('f', 'h', ['p', [h]])
            .always(function(r) {
                var eid = 0;
                var map = function(o) {
                    return Object.keys(o).sort().map(function(h) {
                        return String(h) + ':' + o[h];
                    }).join(',');
                };

                console.debug('Got %s nodes for %s', r.length, h);

                var q = {};
                var j = Object(M.c[h]);
                var l = $.len(j);
                if (r.length !== l) {
                    error = 'Node count mismatch! (' + r.length + ' Vs. ' + l + ')';
                    eid = 1;
                }
                else {
                    r.map(function(n) {
                        q[n.h] = n.t + 1;
                    });
                    var f1 = map(j);
                    var f2 = map(q);

                    if (f1 !== f2) {
                        error = 'Hierarchy mismatch! ("' + f1 + '" Vs. "' + f2 + '")';
                        eid = 2;
                    }
                }

                if (eid) {
                    console.error(error);

                    api_req({
                        a: 'fcv',
                        h: h,
                        v: 2,
                        c: l,
                        r: r.length,
                        cts: Date.now() - M.ccts[h],
                        uts: Date.now() - M.cuts[h],
                        sn: currsn,
                        fsn: mega.fcv_fsn,
                        eid: eid * (u || 1),
                        db: 3
                    }, {}, pfid ? 1 : 0);

                    promise.reject(error);
                }
                else {
                    promise.resolve();
                }
            });
    }

    if (error) {
        console.error(error);
        promise.reject(error);
    }

    return promise;
}


/**
 * Simple wrapper function that will log all calls of `fnName`.
 * This function is intended to be used for dev/debugging/testing purposes only.
 *
 * @param ctx
 * @param fnName
 * @param loggerFn
 */
function callLoggerWrapper(ctx, fnName, loggerFn, textPrefix, parentLogger) {
    if (!window.d) {
        return;
    }

    var origFn = ctx[fnName];
    textPrefix = textPrefix || "missing-prefix";

    var logger = MegaLogger.getLogger(textPrefix + "[" + fnName + "]", {}, parentLogger);
    var logFnName = loggerFn === console.error ? "error" : "debug";

    if (ctx[fnName].haveCallLogger) { // recursion
        return;
    }
    ctx[fnName] = function() {
        // loggerFn.apply(console, [prefix1, prefix2, "Called: ", fnName, arguments]);
        logger[logFnName].apply(logger, ["(calling) arguments: "].concat(toArray.apply(null, arguments)));

        var res = origFn.apply(this, arguments);
        // loggerFn.apply(console, [prefix1, prefix2, "Got result: ", fnName, arguments, res]);
        logger[logFnName].apply(logger, ["(end call) arguments: "].concat(toArray.apply(null, arguments)).concat([
            "returned: ", res
        ]));

        return res;
    };
    ctx[fnName].haveCallLogger = true; // recursion
}

/**
 * Simple Object instance call log helper
 * This function is intended to be used for dev/debugging/testing purposes only.
 *
 *
 * WARNING: This function will create tons of references in the window.callLoggerObjects & also may flood your console.
 *
 * @param ctx
 * @param [loggerFn] {Function}
 * @param [recursive] {boolean}
 */
function logAllCallsOnObject(ctx, loggerFn, recursive, textPrefix, parentLogger) {
    if (!window.d) {
        return;
    }
    loggerFn = loggerFn || console.debug;

    if (typeof parentLogger === "undefined") {
        var logger = new MegaLogger(textPrefix);
    }
    if (!window.callLoggerObjects) {
        window.callLoggerObjects = [];
    }

    $.each(ctx, function(k, v) {
        if (typeof v === "function") {
            callLoggerWrapper(ctx, k, loggerFn, textPrefix, parentLogger);
        }
        else if (typeof v === "object"
            && !$.isArray(v) && v !== null && recursive && !$.inArray(window.callLoggerObjects)) {
            window.callLoggerObjects.push(v);
            logAllCallsOnObject(v, loggerFn, recursive, textPrefix + ":" + k, parentLogger);
        }
    });
}

/**
 * Trace function call usages
 * @param {Object} ctr The desired object to trace.
 */
function dcTracer(ctr) {
    var name = ctr.name || 'unknown',
        proto = ctr.prototype || ctr;
    for (var fn in proto) {
        if (proto.hasOwnProperty(fn) && typeof proto[fn] === 'function') {
            console.log('Tracing ' + name + '.' + fn);
            proto[fn] = (function(fn, fc) {
                fc.dbg = function() {
                    try {
                        console.log('Entering ' + name + '.' + fn,
                            this, '~####~', Array.prototype.slice.call(arguments));
                        var r = fc.apply(this, arguments);
                        console.log('Leaving ' + name + '.' + fn, r);
                        return r;
                    }
                    catch (e) {
                        console.error(e);
                    }
                };
                return fc.dbg;
            })(fn, proto[fn]);
        }
    }
}


mBroadcaster.once('startMega', function() {
    if (d && window.chrome) {
        var usages = Object.create(null);
        var createObjectURL = URL.createObjectURL;
        var revokeObjectURL = URL.revokeObjectURL;

        URL.createObjectURL = function() {
            var stackIdx = 2;
            var stack = M.getStack().split('\n');
            var result = createObjectURL.apply(URL, arguments);

            for (var i = stack.length; i--;) {
                if (stack[i].indexOf('createObjectURL') > 0) {
                    stackIdx = i;
                    break;
                }
            }

            usages[result] = {
                r: 0,
                ts: Date.now(),
                id: MurmurHash3(result, -0x7f000e0),
                stack: stack.splice(stackIdx)
            };

            return result;
        };

        URL.revokeObjectURL = function(objectURL) {
            var result = revokeObjectURL.apply(URL, arguments);

            delete usages[objectURL];
            return result;
        };

        var intv = 60000 / +d;
        setInterval(function() {
            var now = Date.now();
            var known = ['1:setUserAvatar', '1:previewimg', '1:procfa', '2:procfa', '3:addScript'];
            // ^ think twice before whitelisting anything new here...

            for (var uri in usages) {
                var data = usages[uri];

                if ((now - data.ts) > intv) {
                    var warn = true;

                    for (var i = known.length; i--;) {
                        var k = known[i].split(':');

                        if (String(data.stack[k[0]]).indexOf(k[1]) !== -1) {
                            warn = false;
                            break;
                        }
                    }

                    if (warn && !(data.r++ % 10)) {
                        console.warn("[$%s] a call to createObjectURL was not revoked"
                            + " in too long, possible memory leak?", data.id.toString(16), uri, data);
                    }
                }
            }
        }, intv * 1.5);

        window.createObjectURLUsages = usages;
    }
});
