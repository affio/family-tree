import _ from 'underscore'
import angular from 'angular'
import Hammer from 'hammerjs'
import layout from './layout'

const SVG_NS = 'http://www.w3.org/2000/svg'

// WARNING: This directive wraps a lot of direct DOM
// manipulation, it's not very angular-like inside (but
// hopefully it presents a nice Angular face to the rest of
// the world)
angular
  .module('app.directives', [])

  .controller(
    'FamilyTreeController',
    function FamilyTreeController($scope, $element, $interval) {
      let layoutData = null
      let links
      let nodeWidth
      let nodeHeight
      let panx = 0
      let pany = 0
      let scale = 1

      const nodeElements = {}
      const lineElements = []

      const group = () => angular.element($element.find('g')[0])

      const boundingBox = () => $element[0].getBoundingClientRect()

      const applyTransform = () => {
        if (_.isNaN(panx) || _.isNaN(pany)) return
        group().attr(
          'transform',
          `translate(${panx},${pany}) scale(${scale || 1})`,
        )
      }

      let animatingInterval
      const animateTo = (x, y, s, duration) => {
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

      const panTo = (x, y, s) => {
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

      const _setScale = (s, startscale, startx, starty, centerx, centery) => {
        // Constrain the minimum and maximum zoom
        s = Math.max(0.25, Math.min(1.5, s))
        const x = startx - (centerx - startx) * (1 / startscale - 1 / s) * s
        const y = starty - (centery - starty) * (1 / startscale - 1 / s) * s
        panTo(x, y, s)
      }

      const positionNodes = () => {
        if (!layoutData) return
        _.each(nodeElements, (element, id) => {
          const nodePos = layoutData.nodes[id]
          if (nodePos && !_.isNaN(nodePos.x) && !_.isNaN(nodePos.y)) {
            element.attr(
              'transform',
              `translate(${nodePos.x - nodeWidth / 2},${
                nodePos.y - nodeHeight / 2
              })`,
            )
          }
        })
      }

      const drawLines = () => {
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

      this.updateLinks = (focusNodeId, _links, _nodeWidth, _nodeHeight) => {
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
          nodeHeight / 10,
        )

        positionNodes()
        drawLines(nodeWidth, nodeHeight)
        this.focus(focusNodeId, false)
      }

      this.registerNode = (id, element) => {
        nodeElements[id] = element
        positionNodes()

        new Hammer(element[0]).on('tap', () => {
          $scope.$apply(() => this.focus(id, true))
        })
      }

      this.unregisterNode = (id) => {
        delete nodeElements[id]
        positionNodes()
      }

      this.focus = (id, animate) => {
        if (!layoutData) return

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

      this.setScale = (s) => {
        if (s == scale) return
        const bb = boundingBox()
        _setScale(s, scale, panx, pany, bb.width / 2, bb.height / 2)
      }

      this.getScale = () => scale

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
      hammertime.on('pinchstart', (evt) => {
        startscale = scale
        startx = panx
        starty = pany
        scalecenter = evt.center
      })

      hammertime.on('pinchmove', (evt) => {
        $scope.$apply(() => {
          _setScale(
            startscale * evt.scale,
            startscale,
            startx,
            starty,
            scalecenter.x,
            scalecenter.y,
          )
          lastPinch = _.now()
        })
      })

      $element.on('wheel', (evt) => {
        $scope.$apply(() => {
          if (evt.originalEvent) {
            // If jQuery is being used
            evt = evt.originalEvent
          }
          const direction = Math.max(
            -1,
            Math.min(1, evt.wheelDelta || -evt.deltaY),
          )
          this.setScale(scale + direction * 0.1)
        })
        evt.preventDefault()
      })
    },
  )

  .directive('svgFamilyTree', ($parse) => ({
    restrict: 'A',
    controller: 'FamilyTreeController',
    transclude: true,
    template: '<g ng-transclude></g>',
    link: (scope, element, attr, controller) => {
      // Hook up the attributes to the controller
      scope.$watch(
        () => [
          scope.$eval(attr.appLinks),
          parseInt(attr.svgNodeWidth, 10),
          parseInt(attr.svgNodeHeight, 10),
        ],
        (values) => {
          values.unshift(scope.$eval(attr.appFocus))
          controller.updateLinks.apply(controller, values)
        },
        /* objectEquality: */ true,
      )

      scope.$watch(attr.appFocus, (focus) => {
        controller.focus(focus, true)
      })

      scope.$watch(attr.svgScale, (scale) => {
        scale = parseFloat(scale)
        if (!_.isNaN(scale)) {
          controller.setScale(scale)
        }
      })

      scope.$watch(
        () => controller.getScale(),
        (scale) => {
          $parse(attr.svgScale).assign(scope, scale)
        },
      )
    },
  }))

  .directive('svgFamilyTreeNode', () => ({
    restrict: 'A',
    require: '^svgFamilyTree',
    link: (scope, element, attr, controller) => {
      let id

      scope.$watch(attr.appNodeId, (newId) => {
        if (id) controller.unregisterNode(id)

        id = newId
        if (id) controller.registerNode(id, element)
      })

      scope.$on('$destroy', () => {
        if (id) controller.unregisterNode(id)
      })
    },
  }))

  .directive('svgTruncatingTextWidth', () => ({
    restrict: 'A',
    link: (scope, element, attrs) => {
      let truncatedText = null

      if (!element[0].getComputedTextLength) {
        console.warn('getComputedTextLength is not supported')
        return
      }

      const update = () => {
        let text = element.text()

        const maxLength = parseInt(
          scope.$eval(attrs.svgTruncatingTextWidth),
          10,
        )

        if (text === truncatedText) return

        element.attr('title', text)

        while (element[0].getComputedTextLength() > maxLength) {
          text = text.slice(0, -1).trim()
          element.text(`${text}…`)
        }

        truncatedText = `${text}…`
      }

      scope.$watch(attrs.svgTruncatingTextWidth, update)
      scope.$watch(() => element.text(), update)
    },
  }))

  .controller('directives.card.controller', ($scope) => {
    $scope.select = () => console.info('Selected!')
  })

  .directive('appCard', () => ({
    restrict: 'E',
    replace: true,
    controller: 'directives.card.controller',
    scope: {
      type: '@ngType',
      model: '=ngModel',
    },
    template: require('bundle-text:./card.svg'),
  }))
