import fetch from 'node-fetch';
import fs from 'fs';
import humps from 'humps';
import { format, } from 'util';

import debug from 'debug';
const log = debug('swagger-api:all');

export default function buildApiClient( swaggerUrl, apiBase, defaultHeaders ) {
  return collectSwaggerDocs(swaggerUrl, apiBase, defaultHeaders);
}

function collectSwaggerDocs( swaggerUrl, apiBase, headers ) {
  headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...headers,
  };
  const docs = [];
  const api = {
    printDocs() {
      console.log('\n\nAPI DOCS');
      console.log(docs.join('\n'));
    },
  };
  return fetch(swaggerUrl, { headers, })
  .then(( res ) => res.json())
  .then(( res ) => {
    return Promise.all(
      res.apis.map(( rootApiDetails ) => {
        const childApi = {};
        const rootApiBlock = humps.camelize(rootApiDetails.path.replace('/', ''));
        api[ rootApiBlock ] = childApi;
        return fetch(`${ swaggerUrl }${ rootApiDetails.path }`, { headers, })
        .then(( res ) => res.json())
        .then(( res ) => {
          log(rootApiDetails.description);
          res.apis.forEach(( apiDetails ) => {
            docs.push(format('\t%s %s', apiDetails.description, apiDetails.path));
            docs.push(format('\t\tOperations:'));
            apiDetails.operations.forEach(( operation ) => {
              //todo: check for clashes
              const apiName = humps.camelize(operation.nickname[ 0 ].toLowerCase() + operation.nickname.slice(1));
              docs.push(format('\t\t\t%s.%s()', rootApiBlock, apiName));
              docs.push(format('\t\t\t%s %s', operation.method, operation.summary));
              const operationUrlArgs = operation.parameters.filter(( param ) => param.paramType === 'path');
              const operationBodyArgs = operation.parameters.filter(( param ) => param.paramType === 'body');
              childApi[ apiName ] = ( ...args ) => {
                const [ urlArgs, query, body, ] = formatArgs(args, operation.method, operation.parameters);
                validateUrlArgs(operationUrlArgs, urlArgs);
                if ( body ) {
                  validateBodyArgs(operationBodyArgs, body);
                }

                let path = operationUrlArgs.reduce(( str, urlArg, ix ) => {
                  return str.replace(`{${ urlArg.name }}`, urlArgs[ ix ]);
                }, apiDetails.path);

                const queryString = formatQuery(query, operation.notes);
                const url = `${ apiBase }${ path }${ queryString }`;

                log('FETCH %s', url);
                return fetch(url, {
                  method: operation.method,
                  body: JSON.stringify(body),
                  headers,
                })
                .then(( res ) => {
                  log('res %o', res);
                  log(res.headers.get('content-type'));
                  log(res.status);
                  const contentType = res.headers.get('content-type');

                  if ( res.status === 200 ) {

                    if ( contentType.indexOf('text/html') > -1 ) {
                      return res;
                    }
                    if ( contentType.indexOf('application/json') > -1 ) {
                      return res.json()
                      .then(humps.camelizeKeys.bind(null));
                    }

                  } else {
                    throw new Error(`API ERROR: ${ res.status } ${ res.statusText }`);
                  }

                });
              };
            });
          });
        });
      })
    )
    .then(() => api);
  });
}

//
// Helpers
//

function validateUrlArgs( requiredArgs, args ) {
  if ( args.length !== requiredArgs.length ) {
    throw new Error(`${ requiredArgs.length } required, only recieved ${ args.length }. [ ${ requiredArgs.map(( arg ) => arg.name).join(',') } ]`);
  }
  // type checking
  Object.keys(args).forEach(( key ) => {
    for (var i = 0; i < requiredArgs.length; i++) {
      if ( key === requiredArgs[ i ].name ) {
        // check type
      }
    }
  });
}

function validateBodyArgs( requiredArgs, body ) {
  const missingBodyArgs = checkForMissingBodyArgs(requiredArgs, body);
  if ( missingBodyArgs.length > 0 ) {
    throw new Error(`Missing body args [ ${ missingBodyArgs.join(',') } ]`);
  }
  // type checking
  Object.keys(body).forEach(( key ) => {
    for (var i = 0; i < requiredArgs.length; i++) {
      if ( key === requiredArgs[ i ].name ) {
        // check type
      }
    }
  });
}

function formatArgs( args, method, operationParams ) {
  const returnValues = {
    path: [],
  };
  for (var i = args.length - 1; i >= 0; i--) {
    const nextArg = args[ i ];
    if ( typeof nextArg === 'object' ) {
      const type = determineArgTypes(nextArg, operationParams);
      if ( !returnValues[ type ] ) {
        returnValues[ type ] = nextArg;
        continue;
      }
    }
    returnValues.path.push(nextArg);
  }
  return [ returnValues.path, returnValues.query, returnValues.body, ];
}

function formatQuery( query, operationNotes ) {
  if ( !query ) {
    return '';
  }
  const template = operationNotes.match(/\?[^\s]+/)[ 0 ];
  let queryString = Object.keys(query).reduce(( str, key ) => {
    return str.replace(`{${ key }}`, query[ key ]);
  }, template);
  return queryString.replace(/&?[A-z]+\={[^}]+}/g, '');
}

function determineArgTypes( obj, operationParams ) {
  const counts = {};
  const objKeys = Object.keys(obj);
  operationParams.forEach(( param ) => {
    counts[ param.paramType ] = (counts[ param.paramType ] || 0) + (objKeys.indexOf(param.name) > -1 ? 1 : 0);
  });
  return Object.keys(counts).reduce(( maxKey, type ) => {
    return Math.max(counts[ maxKey ], counts[ type ]) === counts[ type ] ? type : maxKey;
  }, Object.keys(counts)[ 0 ]);
}

function checkForMissingBodyArgs( requiredArgs, body ) {
  return requiredArgs.filter(( arg ) => Object.keys(body).indexOf(arg.name) > -1);
}
