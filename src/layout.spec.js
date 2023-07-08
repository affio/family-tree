/* eslint-disable no-param-reassign, no-underscore-dangle, prefer-rest-params */

import { describe, test as it } from 'vitest'
import { expect } from 'chai'
import _ from 'underscore'

import _layout from './layout'

const layout = _.extend({}, _layout, _layout._private)

function splat(fn) {
  return (...args) => fn.apply(this, args[0].concat(_.rest(args)))
}

describe('layout', () => {
  const TEST_DATA = [
    {
      /*
          a
          |
          b
        */
      title: '1x1 no crossings',
      order: [['a'], ['b']],
      crossings: 0,
      links: [{ type: 'child', origin: 'a', target: 'b' }],
    },
    {
      /*
          a b
          | |
          c-d
        */
      title: '2x2 no crossings',
      order: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      crossings: 0,
      links: [
        { type: 'child', origin: 'a', target: 'c' },
        { type: 'child', origin: 'b', target: 'd' },
        { type: 'partner', origin: 'c', target: 'd' },
      ],
    },
    {
      /*
          a b
          /| |\
          c d-e f
        */
      title: '2x4 no crossings',
      order: [
        ['a', 'b'],
        ['c', 'd', 'e', 'f'],
      ],
      crossings: 0,
      links: [
        { type: 'child', origin: 'a', target: 'c' },
        { type: 'child', origin: 'a', target: 'd' },
        { type: 'child', origin: 'b', target: 'e' },
        { type: 'child', origin: 'b', target: 'f' },
        { type: 'partner', origin: 'd', target: 'e' },
      ],
    },
    {
      /*
          a-b
          x
          c d
        */
      title: '2x2 with crossover',
      order: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      breadthFirstOrder: [
        ['a', 'b'],
        ['d', 'c'],
      ],
      medianOrder: [
        ['a', 'b'],
        ['d', 'c'],
      ],
      crossings: 1,
      links: [
        { type: 'child', origin: 'a', target: 'd' },
        { type: 'child', origin: 'b', target: 'c' },
        { type: 'partner', origin: 'a', target: 'b' },
      ],
    },
    {
      /*
          a b
          | |
          \
          \
          \
          _| |
          / | |
          c d-e
        */
      title: 'Another one',
      order: [
        ['a', 'b'],
        ['c', 'd', 'e'],
      ],
      breadthFirstOrder: [
        ['a', 'b'],
        ['e', 'c', 'd'],
      ],

      // Median order takes into account the d-e partner relation
      medianOrder: [
        ['a', 'b'],
        ['c', 'd', 'e'],
      ],
      crossings: 2,
      links: [
        { type: 'child', origin: 'a', target: 'e' },
        { type: 'child', origin: 'b', target: 'c' },
        { type: 'child', origin: 'b', target: 'd' },
        { type: 'partner', origin: 'd', target: 'e' },
      ],
    },
    {
      /*
          a b c
          \ | |
          \+ |
          d-e |
          \__/
        */
      order: [
        ['a', 'b', 'c'],
        ['d', 'e'],
      ],
      breadthFirstOrder: [
        ['a', 'b', 'c'],
        ['e', 'd'],
      ],

      // Median order takes into account the d-e partner relation
      medianOrder: [
        ['a', 'b', 'c'],
        ['d', 'e'],
      ],
      crossings: 2,
      links: [
        { type: 'child', origin: 'a', target: 'e' },
        { type: 'child', origin: 'b', target: 'e' },
        { type: 'child', origin: 'c', target: 'd' },
        { type: 'partner', origin: 'd', target: 'e' },
      ],
    },
  ]

  _.each(TEST_DATA, (d, i) => {
    d.title = d.title || `Test data ${i}`
  })

  describe('.crossings()', () => {
    _.each(TEST_DATA, (data) => {
      it(`should calculate the correct crossing for ${data.title}`, () => {
        expect(layout.crossings(data.order, data.links)).to.equal(
          data.crossings,
        )
      })
    })
  })

  describe('.assignRanks()', () => {
    _.each(TEST_DATA, (data) => {
      it(`should assign ranks correctly for ${data.title}`, () => {
        const ranks = layout.assignRanks('a', data.links)
        _.each(
          _.zip(ranks, data.order),
          splat((a, b) => {
            expect(_.sortBy(a, _.identity)).to.deep.equal(
              _.sortBy(b, _.identity),
            )
          }),
        )
      })
    })
  })

  describe('.breadthFirstOrder()', () => {
    _.each(TEST_DATA, (data) => {
      it(`should find correct breadth first order for ${data.title}`, () => {
        const order = layout.breadthFirstOrder(data.order, data.links)
        _.each(
          _.zip(order, data.breadthFirstOrder || data.order),
          splat((a, b) => {
            expect(a).to.deep.equal(b)
          }),
        )
      })
    })
  })

  describe('.cupid()', () => {
    it('should re-order nodes to put partners together (moving forwards)', () => {
      expect(
        layout.cupid(
          [['a', 'b', 'c']],
          [{ type: 'partner', origin: 'c', target: 'a' }],
        ),
      ).to.deep.equal([['b', 'c', 'a']])
    })

    it('should re-order nodes to put partners together (moving backwards)', () => {
      expect(
        layout.cupid(
          [['a', 'b', 'c']],
          [{ type: 'partner', origin: 'a', target: 'c' }],
        ),
      ).to.deep.equal([['a', 'c', 'b']])
    })

    it('should order partners in the direction of the relationship link', () => {
      expect(
        layout.cupid(
          [['a', 'b', 'c']],
          [{ type: 'partner', origin: 'b', target: 'a' }],
        ),
      ).to.deep.equal([['b', 'a', 'c']])
    })

    it('should leave order alone when partners are already together', () => {
      expect(
        layout.cupid(
          [['a', 'b', 'c']],
          [{ type: 'partner', origin: 'a', target: 'b' }],
        ),
      ).to.deep.equal([['a', 'b', 'c']])
    })
  })

  describe('.partialWeightSort()', () => {
    it('should sorts by weights', () => {
      const list = ['baz', 'foo', 'bar']
      layout.partialWeightSort(list, { foo: 0, bar: 1, baz: 2 })
      expect(list).to.deep.equal(['foo', 'bar', 'baz'])
    })

    it('should does not move items without weights', () => {
      const list = ['hello', 'baz', 'super', 'foo', 'bar', 'moo']
      layout.partialWeightSort(list, { foo: 0, bar: 1, baz: 2 })
      expect(list).to.deep.equal(['hello', 'foo', 'super', 'bar', 'baz', 'moo'])
    })
  })

  describe('.wmedian()', () => {
    _.each(TEST_DATA, (data) => {
      it(`should find correct median order for ${data.title}`, () => {
        const order = layout.wmedian(data.order, data.links, true)
        _.each(
          _.zip(order, data.medianOrder || data.order),
          splat((a, b) => {
            expect(a).to.deep.equal(b)
          }),
        )
      })
    })
  })

  describe('.transpose()', () => {
    it('should swap nodes to get a better graph ordering', () => {
      const order = [
        ['a', 'b', 'c'],
        ['d', 'e', 'f', 'g'],
      ]
      const links = [
        { type: 'child', origin: 'a', target: 'f' },
        { type: 'child', origin: 'b', target: 'e' },
        { type: 'child', origin: 'c', target: 'd' },
        { type: 'child', origin: 'c', target: 'g' },
      ]
      const newOrder = layout.transpose(order, links)
      expect(layout.crossings(order, links)).not.to.equal(0)
      expect(layout.crossings(newOrder, links)).to.equal(0)
    })
  })

  describe('.layout() (sanity checks)', () => {
    it('should produce a layout for some test data', () => {
      const LINKS = [
        { origin: 'dadb', target: 'mumb', type: 'partner' },
        { origin: 'mumb', target: 'sonb', type: 'child' },
        { origin: 'dadb', target: 'sonb', type: 'child' },
        { origin: 'sonb', target: 'grandchildb', type: 'child' },

        { target: 'lady', origin: 'tester', type: 'partner' },
        { target: 'baby', origin: 'tester', type: 'child' },
        { target: 'child2', origin: 'tester', type: 'child' },
        { target: 'child3', origin: 'tester', type: 'child' },
        { target: 'child4', origin: 'tester', type: 'child' },
        { target: 'child5', origin: 'tester', type: 'child' },

        { target: 'baby', origin: 'lady', type: 'child' },
        { target: 'child2', origin: 'lady', type: 'child' },
        { target: 'child3', origin: 'lady', type: 'child' },
        { target: 'child4', origin: 'lady', type: 'child' },
        { target: 'child5', origin: 'lady', type: 'child' },

        { target: 'tester', origin: 'pappa', type: 'child' },
        { target: 'bro', origin: 'pappa', type: 'child' },
        { target: 'halfbro', origin: 'otherwoman', type: 'child' },
        { target: 'halfbro', origin: 'pappa', type: 'child' },
        { target: 'halfsis', origin: 'otherwoman', type: 'child' },
        { target: 'halfsis', origin: 'pappa', type: 'child' },
        { target: 'bro', origin: 'momma', type: 'child' },
        { target: 'tester', origin: 'momma', type: 'child' },
        { target: 'niece', origin: 'bro', type: 'child' },
        { target: 'niece', origin: 'sisterinlaw', type: 'child' },
        { target: 'sisterinlaw', origin: 'bro', type: 'partner' },

        { target: 'ladyssis', origin: 'ladysdad', type: 'child' },
        { target: 'ladyssis', origin: 'ladysmum', type: 'child' },

        { target: 'lady', origin: 'ladysdad', type: 'child' },
        { target: 'lady', origin: 'ladysmum', type: 'child' },
        { target: 'ladysmum', origin: 'ladysdad', type: 'partner' },
      ]
      const nodes = _.union(_.pluck(LINKS, 'target'), _.pluck(LINKS, 'origin'))
      const layoutData = layout.layout('tester', LINKS, 100, 10, 50, 90, 10)

      // Really minimal checks right now, pretty much just testing
      // that the code runs without throwing an exception
      expect(_.intersection(nodes, _.keys(layoutData.nodes)).length).to.equal(
        nodes.length,
      )
      expect(_.isArray(layoutData.lines)).to.equal(true)
    })
  })
})
