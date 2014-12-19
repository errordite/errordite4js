/*
 * errordite4js
 * https://github.com/errordite/errordite4js
 *
 * Copyright (c) 2013 MindscapeHQ
 * Licensed under the MIT license.
 */

(function (window, $, undefined) {


  // pull local copy of TraceKit to handle stack trace collection
  var _traceKit = TraceKit.noConflict(),
      _errordite = window.Errordite,
      _errorditeApiKey,
      _debugMode = false,
      _allowInsecureSubmissions = false,
      _ignoreAjaxAbort = false,
      _enableOfflineSave = false,
      _ignore3rdPartyErrors = false,
      _disableAnonymousUserTracking = false,
      _customData = {},
      _tags = [],
      _user,
      _version,
      _filteredKeys,
      _whitelistedScriptDomains = [],
      _beforeSendCallback,
      _errorditeApiUrl = 'https://www.errordite.com/receiveerror',
      $document;

  if ($) {
    $document = $(document);
  }

  var Errordite =
  {
    noConflict: function () {
      window.Errordite = _errordite;
      return Errordite;
    },

    init: function(key, options, customdata) {
      _errorditeApiKey = key;
      _traceKit.remoteFetching = false;
      _customData = customdata;

      if (options)
      {
        _allowInsecureSubmissions = options.allowInsecureSubmissions || false;
        _ignoreAjaxAbort = options.ignoreAjaxAbort || false;
        _disableAnonymousUserTracking = options.disableAnonymousUserTracking || false;

        if (options.debugMode)
        {
          _debugMode = options.debugMode;
        }
        if(options.ignore3rdPartyErrors)
        {
          _ignore3rdPartyErrors = true;
        }
      }

      sendSavedErrors();

      return Errordite;
    },

    withCustomData: function (customdata) {
      _customData = customdata;
      return Errordite;
    },

    withTags: function (tags) {
      _tags = tags;
      return Errordite;
    },

    attach: function () {
      if (!isApiKeyConfigured()) {
        return Errordite;
      }
      _traceKit.report.subscribe(processUnhandledException);
      if ($document) {
        $document.ajaxError(processJQueryAjaxError);
      }
      return Errordite;
    },

    detach: function () {
      _traceKit.report.unsubscribe(processUnhandledException);
      if ($document) {
        $document.unbind('ajaxError', processJQueryAjaxError);
      }
      return Errordite;
    },

    send: function (ex, customData, tags) {
      try {
        processUnhandledException(_traceKit.computeStackTrace(ex), {
          customData: typeof _customData === 'function' ?
            merge(_customData(), customData) :
            merge(_customData, customData),
          tags: mergeArray(_tags, tags)
        });
      }
      catch (traceKitException) {
        if (ex !== traceKitException) {
          throw traceKitException;
        }
      }
      return Errordite;
    },

    setUser: function (user, isAnonymous, email, fullName, firstName, uuid) {
      _user = {
        'Identifier': user
      };
      if(isAnonymous) {
        _user['IsAnonymous'] = isAnonymous;
      }
      if(email) {
        _user['Email'] = email;
      }
      if(fullName) {
        _user['FullName'] = fullName;
      }
      if(firstName) {
        _user['FirstName'] = firstName;
      }
      if(uuid) {
        _user['UUID'] = uuid;
      }

      return Errordite;
    },

    resetAnonymousUser: function () {
      _private.clearCookie('errordite4js-userid');
    },

    setVersion: function (version) {
      _version = version;
      return Errordite;
    },

    saveIfOffline: function (enableOffline) {
      if (typeof enableOffline !== 'undefined' && typeof enableOffline === 'boolean') {
        _enableOfflineSave = enableOffline;
      }

      return Errordite;
    },

    filterSensitiveData: function (filteredKeys) {
      _filteredKeys = filteredKeys;
      return Errordite;
    },

    whitelistCrossOriginDomains: function (whitelist) {
      _whitelistedScriptDomains = whitelist;
      return Errordite;
    },

    onBeforeSend: function (callback) {
      _beforeSendCallback = callback;

      return Errordite;
    }
  };

  var _private = Errordite._private = Errordite._private || {},
    _seal = Errordite._seal = Errordite._seal || function () {
      delete Errordite._private;
      delete Errordite._seal;
      delete Errordite._unseal;
    },
    _unseal = Errordite._unseal = Errordite._unseal || function () {
      Errordite._private = _private;
      Errordite._seal = _seal;
      Errordite._unseal = _unseal;
    };

  _private.getUuid = function () {
      function _p8(s) {
          var p = (Math.random().toString(16)+"000000000").substr(2,8);
          return s ? "-" + p.substr(0,4) + "-" + p.substr(4,4) : p ;
      }
      return _p8() + _p8(true) + _p8(true) + _p8();
  };

  _private.createCookie = function (name,value,hours) {
    var expires;
      if (hours) {
        var date = new Date();
        date.setTime(date.getTime()+(hours*60*60*1000));
        expires = "; expires="+date.toGMTString();
      }
      else {
        expires = "";
      }

      document.cookie = name+"="+value+expires+"; path=/";
  };

  _private.readCookie = function (name) {
      var nameEQ = name + "=";
      var ca = document.cookie.split(';');
      for(var i=0;i < ca.length;i++) {
          var c = ca[i];
          while (c.charAt(0) === ' ') {
            c = c.substring(1,c.length);
          }
          if (c.indexOf(nameEQ) === 0) {
            return c.substring(nameEQ.length,c.length);
          }
      }
      return null;
  };

  _private.clearCookie = function (key) {
      _private.createCookie(key, '',-1);
  };

  _private.log = function(message, data) {
    if (window.console && window.console.log && _debugMode) {
      window.console.log(message);

      if (data) {
        window.console.log(data);
      }
    }
  };

  /* internals */

  function truncateURL(url){
      // truncate after fourth /, or 24 characters, whichever is shorter
      // /api/1/diagrams/xyz/server becomes
      // /api/1/diagrams/...
      var truncated = url;
      var path = url.split('//')[1];

      if (path) {
        var queryStart = path.indexOf('?');
        var sanitizedPath = path.toString().substring(0, queryStart);
        var truncated_parts = sanitizedPath.split('/').slice(0, 4).join('/');
        var truncated_length = sanitizedPath.substring(0, 48);
        truncated = truncated_parts.length < truncated_length.length?
                        truncated_parts : truncated_length;
        if (truncated !== sanitizedPath) {
            truncated += '..';
        }
      }

      return truncated;
  }

  function processJQueryAjaxError(event, jqXHR, ajaxSettings, thrownError) {
    var message = 'AJAX Error: ' +
        (jqXHR.statusText || 'unknown') +' '+
        (ajaxSettings.type || 'unknown') + ' '+
        (truncateURL(ajaxSettings.url) || 'unknown');

    // ignore ajax abort if set in the options
    if (_ignoreAjaxAbort) {
      if (!jqXHR.getAllResponseHeaders()) {
         return;
       }
    }

    Errordite.send(thrownError || event.type, {
      status: jqXHR.status,
      statusText: jqXHR.statusText,
      type: ajaxSettings.type,
      url: ajaxSettings.url,
      ajaxErrorMessage: message,
      contentType: ajaxSettings.contentType,
      requestData: ajaxSettings.data && ajaxSettings.data.slice ? ajaxSettings.data.slice(0, 10240) : undefined,
      responseData: jqXHR.responseText && jqXHR.responseText.slice ? jqXHR.responseText.slice(0, 10240) : undefined });
  }



  function isApiKeyConfigured() {
    if (_errorditeApiKey && _errorditeApiKey !== '') {
      return true;
    }
    _private.log("Errordite API key has not been configured, make sure you call Errordite.init(yourApiKey)");
    return false;
  }

  function merge(o1, o2) {
    var a, o3 = {};
    for (a in o1) { o3[a] = o1[a]; }
    for (a in o2) { o3[a] = o2[a]; }
    return o3;
  }

  function mergeArray(t0, t1) {
    if (t1 != null) {
      return t0.concat(t1);
    }
    return t0;
  }

  function forEach(set, func) {
    for (var i = 0; i < set.length; i++) {
      func.call(null, i, set[i]);
    }
  }

  function isEmpty(o) {
    for (var p in o) {
      if (o.hasOwnProperty(p)) {
        return false;
      }
    }
    return true;
  }

  function getRandomInt() {
    return Math.floor(Math.random() * 9007199254740993);
  }

  function getViewPort () {
    var e = document.documentElement,
    g = document.getElementsByTagName('body')[0],
    x = window.innerWidth || e.clientWidth || g.clientWidth,
    y = window.innerHeight || e.clientHeight || g.clientHeight;
    return { width: x, height: y };
  }

  function offlineSave (data) {
    var dateTime = new Date().toJSON();

    try {
      var key = 'errorditejs=' + dateTime + '=' + getRandomInt();

      if (typeof localStorage[key] === 'undefined') {
        localStorage[key] = data;
      }
    } catch (e) {
      _private.log('Errordite4JS: LocalStorage full, cannot save exception');
    }
  }

  function localStorageAvailable(){
    try {
      return ('localStorage' in window) && window['localStorage'] !== null;
    } catch(e){
      return false;
    }
  }

  function sendSavedErrors() {
    if (localStorageAvailable() && localStorage && localStorage.length > 0) {
        for (var key in localStorage) {
        if (key.substring(0, 9) === 'errorditejs=') {
          sendToErrordite(JSON.parse(localStorage[key]));

          localStorage.removeItem(key);
        }
      }
    }
  }

  function ensureUser() {
    if (!_user && !_disableAnonymousUserTracking) {
      var userKey = 'errordite4js-userid';
      var rgUserId = _private.readCookie(userKey);
      var anonymousUuid;

      if (!rgUserId) {
        anonymousUuid = _private.getUuid();

        _private.createCookie(userKey, anonymousUuid, 24 * 31);
      } else {
        anonymousUuid = rgUserId;
      }

      Errordite.setUser(anonymousUuid, true, null, null, null, anonymousUuid);
    }
  }

  function filterValue(key, value) {
      if (_filteredKeys) {
          if (Array.prototype.indexOf && _filteredKeys.indexOf === Array.prototype.indexOf) {
              if (_filteredKeys.indexOf(key) !== -1) {
                  return '[removed by filter]';
              }
          } else {
              for (var i = 0; i < _filteredKeys.length; i++) {
                  if (_filteredKeys[i] === key) {
                      return '[removed by filter]';
                  }
              }
          }
      }

      return value;
  }

  function filterObject(reference) {
      if (reference == null) {
          return reference;
      }

      if (Object.prototype.toString.call(reference) !== '[object Object]') {
          return reference;
      }

      for (var propertyName in reference) {
          var propertyValue = reference[propertyName];

          if (propertyValue == null) {
              continue;
          }

          if (Object.prototype.toString.call(propertyValue) === '[object Object]') {
              reference[propertyName] = filterObject(propertyValue);
          } else {
              reference[propertyName] = filterValue(propertyName, propertyValue);
          }
      }

      return reference;
  }

  function processUnhandledException(stackTrace, options) {
    var stack = [],
        qs = {};

    if (_ignore3rdPartyErrors) {
      if (!stackTrace.stack || !stackTrace.stack.length) {
        _private.log('Errordite4JS: Cancelling send due to null stacktrace');
        return;
      }

      var domain = _private.parseUrl('domain');

      var scriptError = 'Script error';
      var msg = stackTrace.message || options.status || scriptError;
      if (msg.substring(0, scriptError.length) === scriptError &&
        stackTrace.stack[0].url !== null &&
        stackTrace.stack[0].url.indexOf(domain) === -1 &&
        (stackTrace.stack[0].line === 0 || stackTrace.stack[0].func === '?')) {
        _private.log('Errordite4JS: cancelling send due to third-party script error with no stacktrace and message');
        return;
      }


      if (stackTrace.stack[0].url !== null && stackTrace.stack[0].url.indexOf(domain) === -1) {
        var allowedDomainFound = false;

        for (var i in _whitelistedScriptDomains) {
          if (stackTrace.stack[0].url.indexOf(_whitelistedScriptDomains[i]) > -1) {
            allowedDomainFound = true;
          }
        }

        if (!allowedDomainFound) {
          _private.log('Errordite4JS: cancelling send due to error on non-origin, non-whitelisted domain');

          return;
        }
      }
    }

    var stackTraceString = '';

    if (stackTrace.stack && stackTrace.stack.length) {
      forEach(stackTrace.stack, function (i, frame) {
        stackTraceString += (frame.func || '[anonymous]') + ' in ' + frame.url + ':line ' + frame.line + ';column ' + frame.column + '\n';

        stack.push({
          'LineNumber': frame.line,
          'ColumnNumber': frame.column,
          'ClassName': 'line ' + frame.line + ', column ' + frame.column,
          'FileName': frame.url,
          'MethodName': frame.func || '[anonymous]'
        });
      });
    }

    var queryString = _private.parseUrl('?');

    if (queryString.length > 0) {
      forEach(queryString.split('&'), function (i, segment) {
        var parts = segment.split('=');
        if (parts && parts.length === 2) {
          var key = decodeURIComponent(parts[0]);
          var value = filterValue(key, parts[1]);

          qs[key] = value;
        }
      });
    }

    if (options === undefined) {
      options = {};
    }

    if (isEmpty(options.customData)) {
      if (typeof _customData === 'function') {
        options.customData = _customData();
      } else {
        options.customData = _customData;
      }
    }

    if (isEmpty(options.tags)) {
      if (typeof _tags === 'function') {
        options.tags = _tags();
      } else {
        options.tags = _tags;
      }
    }

    var screen = window.screen || { width: getViewPort().width, height: getViewPort().height, colorDepth: 8 };
    var custom_message = options.customData && options.customData.ajaxErrorMessage;
    var finalCustomData = filterObject(options.customData);

    try {
      JSON.stringify(finalCustomData);
    } catch (e) {
      var msg = 'Cannot add custom data; may contain circular reference';
      finalCustomData = { error: msg };
      _private.log('Errordite4JS: ' + msg);
    }

    var now = new Date();

    var payload = {
      Token: _errorditeApiKey,
      MachineName: document.domain,
      'Url': location.href,
      'UserAgent': navigator.userAgent,
      'ContextData' : {
        'UtcOffset': new Date().getTimezoneOffset() / -60.0,
        'User-Language': navigator.userLanguage,
        'Document-Mode': document.documentMode,
        'Browser-Width': getViewPort().width,
        'Browser-Height': getViewPort().height,
        'Screen-Width': screen.width,
        'Screen-Height': screen.height,
        'Color-Depth': screen.colorDepth,
        'Browser': navigator.appCodeName,
        'Browser-Name': navigator.appName,
        'Browser-Version': navigator.appVersion,
        'Platform': navigator.platform,
        'Referer': document.referrer
      },
      'ExceptionInfo': {
        'Message': custom_message || stackTrace.message || options.status || 'Script error',
        'ExceptionType' :  custom_message || stackTrace.message || options.status || 'Script error',
        'Source': stackTrace.name,
        'StackTrace': stackTraceString,
        'MethodName': stackTrace.stack[0].func || '[anonymous]'
      },
      'TimestampUtc': now.getUTCFullYear() + '-' + (now.getUTCMonth() + 1) + '-' + now.getUTCDate() + ' ' + now.getUTCHours() + ':' + now.getUTCMinutes() + ':' + now.getUTCSeconds()            
    };

    ensureUser();    

    if (_user){
      extend(payload.ContextData, _user, 'User_');
    }

    if (finalCustomData){
      extend(payload.ContextData, finalCustomData, 'Custom_');
    }

    if (typeof _beforeSendCallback === 'function') {
      var mutatedPayload = _beforeSendCallback(payload);

      if (mutatedPayload) {
        sendToErrordite(mutatedPayload);
      }
    } else {
      sendToErrordite(payload);
    }
  }

  function sendToErrordite(data) {
    if (!isApiKeyConfigured()) {
      return;
    }

    _private.log('Sending exception data to Errordite:', data);
    var url = _errorditeApiUrl;
    makePostCorsRequest(url, JSON.stringify(data));
  }

  function extend(original, extra, extraPrefix){
    extraPrefix = extraPrefix || '';
    for(var key in extra){
      original[extraPrefix + key] = extra[key];
    }
  }

  // Create the XHR object.
  function createCORSRequest(method, url) {
    var xhr;

    xhr = new window.XMLHttpRequest();
    if ("withCredentials" in xhr) {
      // XHR for Chrome/Firefox/Opera/Safari.
      xhr.open(method, url, true);

    } else if (window.XDomainRequest) {
      // XDomainRequest for IE.
      if (_allowInsecureSubmissions) {
        // remove 'https:' and use relative protocol
        // this allows IE8 to post messages when running
        // on http
        url = url.slice(6);
      }

      xhr = new window.XDomainRequest();
      xhr.open(method, url);
    }

    xhr.timeout = 10000;

    return xhr;
  }

  // Make the actual CORS request.
  function makePostCorsRequest(url, data) {
    var xhr = createCORSRequest('POST', url, data);

    if ('withCredentials' in xhr) {

      xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) {
          return;
        }

        if (xhr.status === 202) {
          sendSavedErrors();
        } else if (_enableOfflineSave && xhr.status !== 403 && xhr.status !== 400) {
          offlineSave(data);
        }
      };

      xhr.onload = function () {
        _private.log('logged error to Errordite');
      };

    } else if (window.XDomainRequest) {
      xhr.ontimeout = function () {
        if (_enableOfflineSave) {
          _private.log('Errordite: saved error locally');
          offlineSave(data);
        }
      };

      xhr.onload = function () {
        _private.log('logged error to Errordite');
        sendSavedErrors();
      };
    }

    xhr.onerror = function () {
      _private.log('failed to log error to Errordite');
    };

    if (!xhr) {
      _private.log('CORS not supported');
      return;
    }

    xhr.send(data);
  }

  window.Errordite = Errordite;

})(window, window.jQuery);

