var camel = require('change-case').camel;
var textConverter = require('./text-converter');
var schemaBuilder = require('./schema-builder');
var _assign = require('lodash').assign;
var _ = require('underscore');

var routeParser = module.exports = {
  convertRouteToSocketHookData: function convertRouteToSocketHookData(route, classDef, typeRegistry) {
    return {
      event: routeParser.getSocketHookEvent(route.method),
      accepts: routeParser.getSocketHookAccepts(route, classDef, typeRegistry),
      path: route.path,
      method: routeParser.convertVerb(route.verb),
      description: route.description
    };
  },

  /**
   * Format Loopback Route method to Socket Hook Event in following formats:
   * model:method:item
   * model:method
   * */
  getSocketHookEvent: function getSocketHookEvent(method) {
    var methodParts = method.split('.');
    var event = '';
    methodParts.forEach(function (part) {
      if (part != 'prototype') {
        var methodData = part.split('__');
        methodData.forEach(function (data) {
          if (data.length > 0) {
            event += event.length > 0 ? ':' + camel(data) : camel(data);
          }
        });
      }
    });
    return event;
  },

  getSocketHookAccepts: function getSocketHookAccepts(route, classDef, typeRegistry) {
    var accepts = route.accepts || [];
    var split = route.method.split('.');
    if (classDef && classDef.sharedCtor &&
      classDef.sharedCtor.accepts && split.length > 2 /* HACK */) {
      accepts = accepts.concat(classDef.sharedCtor.accepts);
    }

    // Filter out parameters that are generated from the incoming request,
    // or generated by functions that use those resources.
    accepts = accepts.filter(function (arg) {
      if (!arg.http) return true;
      // Don't show derived arguments.
      if (typeof arg.http === 'function') return false;
      // Don't show arguments set to the incoming http request.
      // Please note that body needs to be shown, such as User.create().
      if (arg.http.source === 'req' ||
        arg.http.source === 'res' ||
        arg.http.source === 'context') {

        return false;
      }
      return true;
    });

    // Turn accept definitions in to parameter docs.
    accepts = accepts.map(
      routeParser.acceptToParameter(route, classDef, typeRegistry));

    return accepts;
  },

  acceptToParameter: function acceptToParameter(route, classDef, typeRegistry) {
    var DEFAULT_TYPE =
      route.verb.toLowerCase() === 'get' ? 'query' : 'formData';

    return function (accepts) {
      var name = accepts.name || accepts.arg;
      var paramType = DEFAULT_TYPE;

      // TODO: Regex. This is leaky.
      if (route.path.indexOf(':' + name) !== -1) {
        paramType = 'path';
      }

      // Check the http settings for the argument
      if (accepts.http && accepts.http.source) {
        paramType = accepts.http.source;
      }

      // TODO: ensure that paramType has a valid value
      //  path, query, header, body, formData

      var paramObject = {
        name: name,
        in: paramType,
        description: textConverter.convertText(accepts.description),
        required: !!accepts.required
      };

      var schema = schemaBuilder.buildFromLoopBackType(accepts, typeRegistry);
      if (paramType === 'body') {
        // HACK: Derive the type from model
        if (paramObject.name === 'data' && schema.type === 'object') {
          paramObject.schema = {$ref: typeRegistry.reference(classDef.name)};
        } else {
          paramObject.schema = schema;
        }
      } else {
        var isComplexType = schema.type === 'object' ||
          schema.type === 'array' ||
          schema.$ref;
        if (isComplexType) {
          paramObject.type = 'string';
          paramObject.format = 'JSON';
          // TODO support array of primitive types
          // and map them to Swagger array of primitive types
        } else {
          _assign(paramObject, schema);
        }
      }
      if (paramObject.schema && paramObject.schema.$ref) {
        paramObject.modelParams = {};
        var def = typeRegistry.getDefinitionByTypeName(paramObject.schema.$ref);
        for (var property in def.properties) {
          paramObject.modelParams[property] = def.properties[property];
          if (_.indexOf(def.required, property) >= 0) {
            paramObject.modelParams[property].required = true;
          }
        }
        paramObject.modelName = paramObject.schema.$ref;

      }
      return paramObject;
    };
  },

  convertVerb: function convertVerb(verb) {
    if (verb.toLowerCase() === 'all') {
      return 'post';
    }

    if (verb.toLowerCase() === 'del') {
      return 'delete';
    }

    return verb.toLowerCase();
  }
}