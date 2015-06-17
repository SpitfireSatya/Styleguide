var request = require('request'),
  jf = require('jsonfile'),
  helpers = require('./helpers.js'),
  fs = require('fs'),
  config = JSON.parse(fs.readFileSync('./styleguide_config.txt', 'utf8')),

  exports = module.exports = {};

var findSnippet = function(snippetId, callback) {
  var dataPath,
    snippets,
    desireableSnippet,
    index,
    length = config.categories.length;
  for (index = 0; index < length; index++) {
    dataPath = config.database + config.categories[index].name + config.extension;
    snippets = jf.readFileSync(dataPath, {
      throws: false
    }) || [];
    desireableSnippet = snippets.filter(helpers.filterOutById, snippetId)[0];
    if (desireableSnippet) {
      callback({
        snippet: desireableSnippet,
        category: index
      });
    }
  }
};

var parseTypoghraphy = function(theme, sass) {
  var weights,
    typography,
    type,
    rawTypoArray,
    fontValue,
    variableName,
    index,
    length;

  //matches everything between //-- typo:start --// and //-- typo:end --/ including these markers
  typography = sass.match(/\/\/-- typo:start[\d\D]*?typo:end --\/\//gi);
  rawTypoArray = typography[0].split('\n');

  //removing markers
  rawTypoArray.shift();
  rawTypoArray.pop();

  rawTypoArray = rawTypoArray.filter(helpers.filterOutNotVars);

  //Constructing types array
  typography = [];

  for (index = 0, length = rawTypoArray.length; index < length; index++) {
    //matches from $ to :, including $. To take variable name.
    variableName = rawTypoArray[index].match(/\$[\d\D]*?(?=:)/gi)[0];
    //matches from : to ;, including :. To take variable value.
    fontValue = rawTypoArray[index].match(/(?=:)[\d\D]*?(?=;)/)[0];
    //matches everything in between (), including (. To take font weights.
    weights = rawTypoArray[index].match(/\([\d\D]*?(?=\))/gi);

    fontValue = fontValue.substring(1, fontValue.length).trim();

    if (weights) {
      weights = weights[0];
      weights = weights.substring(1, weights.length);
      weights = weights.replace(/ /g, '').split(',');
      weights = weights.map(helpers.convertToNumber);
      weights = weights.sort();
    } else {
      console.log('Weights were not found for ' + variableName + '.');
    }

    type = {
      variable: variableName,
      value: fontValue,
      weights: weights
    };

    typography.push(type);
  }

  theme.typography = typography;
};

var parseColors = function(theme, sass) {
  //matches everything between //-- colors:start --// and //-- colors:end --/ including these markers
  var rawColArray = sass.match(/\/\/-- colors:start[\d\D]*?colors:end --\/\//gi),
    unassignedColors = [],
    assignedColors = {},
    iterations = 0,
    index,
    length,
    variableName,
    hexOrVarValue,
    color;

  for (index = 0, length = rawColArray.length; index < length; index++) {
    rawColArray[index] = rawColArray[index].split('\n');

    //remove dom markers
    rawColArray[index].shift();
    rawColArray[index].pop();

    unassignedColors = unassignedColors.concat(rawColArray[index]);
  }

  unassignedColors = unassignedColors.filter(helpers.filterOutNotVars);

  //prepare array structure
  for (index = 0, length = unassignedColors.length; index < length; index++) {
    //matches from $ to :, including $. To take variable name.
    variableName = unassignedColors[index].match(/\$[\d\D]*?(?=:)/gi)[0];
    //matches from : to ;, including :. To take variable value.
    hexOrVarValue = unassignedColors[index].match(/\:[\d\D]*?(?=;)/gi)[0];

    hexOrVarValue = hexOrVarValue.substring(1, hexOrVarValue.length).trim();

    unassignedColors[index] = {
      variable: variableName,
      value: hexOrVarValue
    };
  }

  while (iterations < config.maxSassIterations && unassignedColors.length) {
    for (index = 0; index < unassignedColors.length; index++) {
      if (unassignedColors[index].value.indexOf('$') !== 0) {
        if (assignedColors[unassignedColors[index].value]) {
          assignedColors[unassignedColors[index].value].push(unassignedColors[index].variable);
        } else {
          assignedColors[unassignedColors[index].value] = [unassignedColors[index].variable];
        }

        unassignedColors.splice(index, 1);
      } else {
        for (color in assignedColors) {
          if (assignedColors[color].indexOf(unassignedColors[index].value) !== -1) {
            assignedColors[color].push(unassignedColors[index].variable);
            unassignedColors.splice(index, 1);
            break;
          }
        }
      }
    }
    iterations++;
  }

  if (iterations === config.maxSassIterations) {
    console.log('Iterations reached max size, your variables json file could be inaccurate!\nThis means, that variable r-value is trying to show to non existing variable!');
  }

  theme.colors = assignedColors;
};

exports.requestPages = function(urls, callback) {
  var results = {},
    t = urls.length,
    c = 0,
    handler = function(error, response, body) {
      var url = response.request.uri.href;
      results[url] = {
        error: error,
        response: response,
        body: body
      };
      if (++c === urls.length) {
        callback(results);
      }
    };

  while (t--) {
    request(urls[t], handler);
  }
};

exports.buildSnippetFromHtml = function(filteredHTml, snippets) {
  //matches <!-- snippet:start 5:6 --> in string. only to take dom marker.
  var domMarker = filteredHTml.match(/<!-- snippet:start [\d\D]*? -->/gi)[0],
    //matches if there is include-js in domMarker
    includeJs = domMarker.match(/include-js/i),
    //matches all numbers, that are in domMarker (first will be snippet id, second if exists - category id)
    extractedIds = domMarker.match(/[\d]+/g),
    //matches from first > to <!, including >. Used to trim off dom markers from html.
    code = filteredHTml.match(/(?=>)[\d\D]*?(?=<!)/gi)[0],
    snippetId,
    categoryId,
    newSnippet;

  code = code.slice(1);
  if (extractedIds) {
    snippetId = Number(extractedIds[0]);
    categoryId = extractedIds[1] ? Number(extractedIds[1]) : 0;
  }

  if (!snippetId) {
    console.log('Snippet ID is not defined! In: ' + filteredHTml);
    return false;
  }

  newSnippet = {
    id: snippetId,
    name: '',
    code: code.trim(),
    description: '',
    inlineCss: '#snippet { \n  \n}',
    includeJs: includeJs ? true : false,
    isEdited: false,
    isDeleted: false
  };

  snippets[categoryId] = snippets[categoryId] ? snippets[categoryId].concat(newSnippet) : [newSnippet];
  return newSnippet;
};

exports.writeOutSnippets = function(snippets, category, uniques) {
  var dataPath,
    snippet,
    dataStore,
    index,
    nestedIndex,
    nestedLen,
    oldCategoryPath,
    oldCatSnippets,
    foundSnippetCallback,
    length = config.categories.length;

  for (index = 0; index < length; index++) {
    if (config.categories[index].id === Number(category)) {
      dataPath = config.database + config.categories[index].name + config.extension;
      break;
    }
  }

  if (!dataPath) {
    console.log('Category with id: ' + category + ' not found.');
    return false;
  }

  dataStore = jf.readFileSync(dataPath, {
    throws: false
  }) || [];

  snippet = snippets[category];

  foundSnippetCallback = function(snippetAndCategory) {
    if (!snippetAndCategory.snippet.isEdited) {
      if (snippetAndCategory.category == category) {
        for (nestedIndex = 0, nestedLen = dataStore.length; nestedIndex < nestedLen; nestedIndex++) {
          if (dataStore[nestedIndex].id == snippetAndCategory.snippet.id) {
            break;
          }
        }
      } else {
        for (nestedIndex = 0, nestedLen = config.categories.length; nestedIndex < nestedLen; nestedIndex++) {
          if (config.categories[nestedIndex].id == snippetAndCategory.category) {
            oldCategoryPath = config.database + config.categories[nestedIndex].name + config.extension;
            break;
          }
        }

        oldCatSnippets = jf.readFileSync(oldCategoryPath, {
          throws: false
        }) || [];

        for (nestedIndex = 0, nestedLen = oldCatSnippets.length; nestedIndex < nestedLen; nestedIndex++) {
          if (oldCatSnippets[nestedIndex].id == snippetAndCategory.snippet.id) {
            break;
          }
        }

        oldCatSnippets.splice(nestedIndex, 1);
        dataStore.push(snippet[index]);
      }
    } else {
      console.log('Snippet was edited.');
    }
  };

  for (index = 0, length = snippet.length; index < length; index++) {
    if (uniques.indexOf(snippet[index].id) === -1) {
      uniques.push(snippet[index].id);
      dataStore.push(snippet[index]);
    } else {
      findSnippet(snippet[index].id, foundSnippetCallback);
    }
  }

  jf.writeFileSync(dataPath, dataStore);
};

exports.scrapeTheme = function(themeIndex, result) {
  var sass,
    theme = {};

  sass = fs.readFileSync(config.sassResources[themeIndex], {
    encoding: 'utf-8'
  });
  theme.name = config.sassResources[themeIndex];

  //matches everything between //-- typo:start --// and //-- typo:end --/ including these markers
  if (sass.search(/\/\/-- typo:start[\d\D]*?typo:end --\/\//gi) !== -1) {
    parseTypoghraphy(theme, sass);
  } else {
    console.log('Typography markers not found in ' + theme.name + '.');
  }

  //matches everything between //-- colors:start --// and //-- colors:end --/ including these markers
  if (sass.search(/\/\/-- colors:start[\d\D]*?colors:end --\/\//gi) !== -1) {
    parseColors(theme, sass);
  } else {
    console.log('Color markers not found in ' + theme.name + '.');
  }

  result.push(theme);
};