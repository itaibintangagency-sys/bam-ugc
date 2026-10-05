'use strict';
module.exports = {
  ...require('./catalog'),
  ...require('./planner'),
  ...require('./shuffle'),
  ...require('./storyboardPrompt'),
  ...require('./videoJson'),
  ...require('./intro'),
  ...require('./voice'),
  ...require('./lint'),
  ...require('./neutralize'),
  ...require('./labels')
};
