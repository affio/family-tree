import angular from 'angular'
import app from './src/app'

// 1.2.x compatibility, angular.resumeBootstrap()
// takes an optional array of modules that should be added to the original list of modules that the app was about to be bootstrapped with
window.name = 'NG_DEFER_BOOTSTRAP!'

// ng-app appended to <html> element,
// resumes bootstrap once DOM is ready
angular
  .element(angular.element(document.getElementsByTagName('html')[0]))
  .ready(() => angular.resumeBootstrap([app.name]))
