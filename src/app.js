import angular from 'angular'
import './directives'

import { self, members, relationships } from './fixtures.json'
import svgTemplate from './tree.svg'

export default angular
  .module('app', ['app.directives'])
  .controller('app.controller', ($scope) => {
    $scope.svgTemplate = svgTemplate

    $scope.model = {
      family: () => members,
      links: () => relationships,
      self: () => members.find(({ _id }) => _id === self),
    }
  })
