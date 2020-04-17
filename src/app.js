import angular from 'angular'
import './directives'

import { self, members, relationships } from './fixtures.json'

export default angular
  .module('app', ['app.directives'])
  .controller('app.controller', ($scope) => {
    // eslint-disable-next-line global-require
    $scope.svgTemplate = require('./tree.svg')

    $scope.model = {
      family: () => members,
      links: () => relationships,
      self: () => members.find(({ _id }) => _id === self),
    }
  })
