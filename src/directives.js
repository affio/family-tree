/* eslint-disable no-param-reassign, no-use-before-define, no-underscore-dangle, no-shadow, no-restricted-globals, prefer-spread, eqeqeq */

import _ from 'underscore'
import Hammer from 'hammerjs'
import angular from 'angular'
import layout from './layout'

const SVG_NS = 'https://www.w3.org/2000/svg'

// WARNING: This directive wraps a lot of direct DOM
// manipulation, it's not very angular-like inside (but
// hopefully it presents a nice Angular face to the rest of
// the world)
angular
  .module('app.directives', [])
  .controller('FamilyTreeController', function ($scope, $element, $interval) {
    let layoutData = null
    const nodeElements = {}
    const lineElements = []
    let links
    let nodeWidth
    let nodeHeight
    let panx = 0
    let pany = 0
    let scale = 1
    const self = this

    function group() {
      return angular.element($element.find('g')[0])
    }

    function boundingBox() {
      return $element[0].getBoundingClientRect()
    }

    this.updateLinks = function (focusNodeId, _links, _nodeWidth, _nodeHeight) {
      links = _links
      nodeWidth = _nodeWidth
      nodeHeight = _nodeHeight
      focusNodeId = focusNodeId || (links[0] && links[0].origin)
      layoutData = layout.layout(
        focusNodeId,
        links,
        nodeWidth,
        nodeWidth / 10,
        (nodeWidth / 10) * 2,
        nodeHeight * 1.5,
        nodeHeight / 10
      )
      positionNodes()
      drawLines(nodeWidth, nodeHeight)
      this.focus(focusNodeId, false)
    }

    this.registerNode = function (id, element) {
      nodeElements[id] = element
      positionNodes()

      new Hammer(element[0]).on('tap', function () {
        $scope.$apply(function () {
          self.focus(id, true)
        })
      })
    }

    this.unregisterNode = function (id) {
      delete nodeElements[id]
      positionNodes()
    }

    this.focus = function (id, animate) {
      if (!layoutData) return

      // this.updateLinks(id, links, nodeWidth, nodeHeight);
      const bb = boundingBox()
      const s = 1
      const x = bb.width / 2 - layoutData.nodes[id].x * s
      const y = bb.height / 2 - layoutData.nodes[id].y * s
      if (animate) {
        animateTo(x, y, s, 200)
      } else {
        panTo(x, y, s)
      }
      $scope.$emit('ftFocusNode', id)
    }

    this.setScale = function (s) {
      if (s == scale) return
      const bb = boundingBox()
      _setScale(s, scale, panx, pany, bb.width / 2, bb.height / 2)
    }

    this.getScale = function () {
      return scale
    }

    function applyTransform() {
      if (_.isNaN(panx) || _.isNaN(pany)) return
      group().attr(
        'transform',
        `translate(${panx},${pany}) scale(${scale || 1})`
      )
    }

    let animatingInterval
    function animateTo(x, y, s, duration) {
      // sin(x)/2+0.5 from -pi/2 to pi/2 gives a nice curve
      // with ease in and ease out
      const start = _.now()
      const startx = panx
      const starty = pany
      const starts = scale
      function step() {
        const progress = (_.now() - start) / duration
        if (progress >= 1) {
          panx = x
          pany = y
          scale = s
          $interval.cancel(animatingInterval)
        } else {
          const d = Math.sin((progress - 0.5) * Math.PI) / 2 + 0.5
          panx = startx + (x - startx) * d
          pany = starty + (y - starty) * d
          scale = starts + (s - starts) * d
        }
        applyTransform()
      }
      $interval.cancel(animatingInterval)
      animatingInterval = $interval(step, 10)
    }

    function panTo(x, y, s) {
      $interval.cancel(animatingInterval)
      scale = s || scale
      const bb = boundingBox()
      const maxx =
        (_.min(_.pluck(layoutData.nodes, 'x')) - nodeWidth * 1.5) * scale +
        bb.width
      const minx =
        -(_.max(_.pluck(layoutData.nodes, 'x')) - nodeWidth * 0.5) * scale
      panx = Math.max(minx, Math.min(maxx, x))
      const maxy =
        (_.min(_.pluck(layoutData.nodes, 'y')) - nodeHeight * 2) * scale +
        bb.height
      const miny =
        -(_.max(_.pluck(layoutData.nodes, 'y')) - nodeHeight * 0.5) * scale
      pany = Math.max(miny, Math.min(maxy, y))
      applyTransform()
    }

    function _setScale(s, startscale, startx, starty, centerx, centery) {
      // Constrain the minimum and maximum zoom
      s = Math.max(0.25, Math.min(1.5, s))
      const x = startx - (centerx - startx) * (1 / startscale - 1 / s) * s
      const y = starty - (centery - starty) * (1 / startscale - 1 / s) * s
      panTo(x, y, s)
    }

    function positionNodes() {
      if (!layoutData) return
      _.each(nodeElements, function (element, id) {
        const nodePos = layoutData.nodes[id]
        if (nodePos && !_.isNaN(nodePos.x) && !_.isNaN(nodePos.y)) {
          element.attr(
            'transform',
            `translate(${nodePos.x - nodeWidth / 2},${
              nodePos.y - nodeHeight / 2
            })`
          )
        }
      })
      focus('child2')
    }

    function drawLines() {
      if (!layoutData) return

      // More of a D3 style, but in Angular, sorry!
      // first enter(): Create line elements needed
      _.times(layoutData.lines.length - lineElements.length, () => {
        const el = angular.element(document.createElementNS(SVG_NS, 'line'))
        el.attr('class', 'ft-line')
        lineElements.push(el)
        group().prepend(el)
      })

      // now exit(): delete line elements we don't need
      _.times(lineElements.length - layoutData.lines.length, () => {
        const el = lineElements.pop()
        el.remove()
      })

      // Now bind data
      _.map(_.zip(lineElements, layoutData.lines), (pair) => {
        const el = pair[0]
        const d = pair[1]
        if (_.every(d)) el.attr(_.pick(d, 'x1', 'y1', 'x2', 'y2'))
      })
    }

    // Handle dragging to pan
    const hammertime = new Hammer($element[0])
    let lastPinch = 0
    hammertime.get('pinch').set({ enable: true })

    let startx
    let starty
    hammertime.on('panstart', () => {
      startx = panx
      starty = pany
    })

    hammertime.on('pan', (evt) => {
      if (_.now() - lastPinch < 300) {
        return
      }
      panTo(startx + evt.deltaX, starty + evt.deltaY)
    })

    let startscale
    let scalecenter
    hammertime.on('pinchstart', function (evt) {
      startscale = scale
      startx = panx
      starty = pany
      scalecenter = evt.center
    })

    hammertime.on('pinchmove', function (evt) {
      // var s =  startscale * evt.scale;
      // // Constrain the minimum and maximum zoom
      // s = Math.max(0.25, Math.min(1.5, s));
      // var x = startx - (scalecenter.x - startx) * (1/startscale - 1/s) * s;
      // var y = starty - (scalecenter.y - starty) * (1/startscale - 1/s) * s;
      // panTo(x,y,s);
      $scope.$apply(function () {
        _setScale(
          startscale * evt.scale,
          startscale,
          startx,
          starty,
          scalecenter.x,
          scalecenter.y
        )
        lastPinch = _.now()
      })
    })

    $element.on('wheel', function (evt) {
      $scope.$apply(function () {
        if (evt.originalEvent) {
          // If jQuery is being used
          evt = evt.originalEvent
        }
        const direction = Math.max(
          -1,
          Math.min(1, evt.wheelDelta || -evt.deltaY)
        )
        self.setScale(scale + direction * 0.1)
      })
      evt.preventDefault()
    })
  })

  .directive('svgFamilyTree', function ($parse) {
    return {
      restrict: 'A',
      controller: 'FamilyTreeController',
      transclude: true,
      compile(element, attrs, transclude) {
        return function (scope, element, attr, controller) {
          // Insert the extra <g> to handle pan-zoom
          const g = angular.element(document.createElementNS(SVG_NS, 'g'))
          element.append(g)
          transclude(scope, function (clone) {
            g.append(clone)
          })

          // Hook up the attributes to the controller
          const attrWatch = `[${_.map(
            ['appLinks', 'svgNodeWidth', 'svgNodeHeight'],
            _.propertyOf(attr)
          ).join(',')}]`
          scope.$watch(
            attrWatch,
            function (values) {
              values.unshift(scope.$eval(attr.appFocus))
              controller.updateLinks.apply(controller, values)
            },
            true
          )

          scope.$watch(attr.appFocus, function (focus) {
            controller.focus(focus, true)
          })

          scope.$watch(attr.svgScale, function (scale) {
            scale = parseFloat(scale)
            if (!_.isNaN(scale)) {
              controller.setScale(scale)
            }
          })

          scope.$watch(
            function () {
              return controller.getScale()
            },
            function (scale) {
              $parse(attr.svgScale).assign(scope, scale)
            }
          )
        }
      },
    }
  })

  .directive('svgFamilyTreeNode', function () {
    return {
      restrict: 'A',
      require: '^svgFamilyTree',
      link(scope, element, attr, controller) {
        let id
        scope.$watch(attr.appNodeId, function (newId) {
          if (id) {
            controller.unregisterNode(id)
          }
          id = newId
          if (id) {
            controller.registerNode(id, element)
          }
        })

        scope.$on('$destroy', function () {
          if (id) {
            controller.unregisterNode(id)
          }
        })
      },
    }
  })

  .directive('svgTruncatingTextWidth', function () {
    return {
      restrict: 'A',
      link(scope, element, attrs) {
        let truncatedText = null
        if (!element[0].getComputedTextLength) {
          console.log('getComputedTextLength not supported!')
          return
        }
        function update() {
          let text = element.text()
          const maxLength = parseInt(
            scope.$eval(attrs.svgTruncatingTextWidth),
            10
          )
          if (text === truncatedText) return
          element.attr('title', text)
          while (element[0].getComputedTextLength() > maxLength) {
            text = text.slice(0, -1).trim()
            element.text(`${text}...`)
          }
          truncatedText = `${text}...`
        }
        scope.$watch(attrs.svgTruncatingTextWidth, update)
        scope.$watch(function () {
          return element.text()
        }, update)
      },
    }
  })

  .controller('directives.card.controller', function ($scope) {
    $scope.select = () => console.info('Selected!')
  })

  .directive('appCard', () => {
    return {
      restrict: 'E',
      replace: true,
      controller: 'directives.card.controller',
      scope: {
        type: '@ngType',
        model: '=ngModel',
      },
      // eslint-disable-next-line global-require
      templateUrl: require('./card.svg'),
    }
  })
