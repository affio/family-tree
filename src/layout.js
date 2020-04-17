/* eslint-disable no-constant-condition, no-param-reassign, no-use-before-define, no-shadow, prefer-destructuring, prefer-rest-params, prefer-const, no-var, vars-on-top, block-scoped-var, no-lonely-if, no-plusplus, consistent-return */

import _ from 'underscore'

// Work out layout for family tree to make it as readable and as
// aesthetically pleasing as possible.
//  - Try to center parents on children
//  - Try to be as compact as possible
//  - Minimise edge crossings (lines going over eachother)
//  - Keep people with their partners

// Works in 4 steps:
//  1. Rank assignment (figure out what rank/generation each node is)
//     - Does a breadth first search starting at the focus node
//       assigning ranks based on the relationships from there
//     - Normalises ranks so they start at 0
//  2. Vertex ordering (what order should the nodes in each
//     rank/generation/row be)
//     - Based on [TDDG] A Technique for Drawing Directed Graphs
//       http://www.graphviz.org/Documentation/TSE93.pdf (see section
//       3). but with some simplifications and some extra bits based
//       on our restricted type of graph
//     - Iterative algorithm that starts with a breadth first search
//       order (from first or last rank) then for each round first
//       assigns order based on median order of connections then tries
//       transposing neighbouring nodes.
//  3. Node coordinates (decide on the actual coordinates for the nodes)
//     - Greedy recursive layout starting from the top left
//  4. Lines (work out the lines to draw between nodes)

// Set to true for console trace output (make it VERY slow)
const TRACE = false

const assert = function (assertion, message) {
  if (console && console.assert) {
    console.assert(assertion, message)
  } else if (!assertion) {
    throw new Error(`Asssertion failed: ${message}`)
  }
}

if (TRACE) {
  if (console && !console.groupCollapsed) {
    console.groupCollapsed = function (x) {
      console.log(`${x} {`)
    }
  }
  if (console && !console.groupEnd) {
    console.groupEnd = function () {
      console.log('}')
    }
  }
}

//
// Utilities
//

// Take a function that accepts an array as it's first argument
// and instead use the elements of that array as the first
// arguments.
function splat(fn) {
  return function () {
    return fn.apply(this, arguments[0].concat(_.rest(arguments)))
  }
}

function sum(list) {
  return _.reduce(
    list,
    function (memo, num) {
      return memo + num
    },
    0
  )
}

// Find the first index in the array that matches the predicate
function findIndex(list, predicate, startIndex) {
  let i
  for (i = startIndex || 0; i < list.length; i++) {
    if (predicate(list[i])) {
      return i
    }
  }
  return -1
}

// Find the last index in the array that matches the predicate
function findLastIndex(list, predicate, startIndex) {
  let i
  if (_.isUndefined(startIndex)) {
    startIndex = list.length - 1
  }
  for (i = startIndex; i >= 0; i--) {
    if (predicate(list[i])) {
      return i
    }
  }
  return -1
}

// Mutation swap of elements in an array
function swap(list, i, j) {
  const tmp = list[i]
  list[i] = list[j]
  list[j] = tmp
}

// Return the list as sublists for which the equality matchs
// [a] -> (a -> a -> boolean) -> [[a]]
function adjacentGroupBy(list, equality) {
  assert(_.isArray(list), 'list should be an array')
  assert(
    _.isFunction(equality) || _.isUndefined(equality),
    'equality should be a function if given'
  )

  let next = null
  const ret = []
  equality =
    equality ||
    function (a, b) {
      return a === b
    }
  _.each(list, function (x) {
    if (next) {
      if (equality(_.last(next), x)) {
        next.push(x)
      } else {
        ret.push(next)
        next = [x]
      }
    } else {
      next = [x]
    }
  })
  if (next) {
    ret.push(next)
  }
  return ret
}

// Group a list of people into partners (assuming the partners are
// already adjacent). Can also include "defacto partners" who are
// people not together but who share the same children.
function partnerGroups(people, links, includeDefactoPartners) {
  // Lines between parents and children
  const partnerLookup = _.indexBy(_.where(links, { type: 'partner' }), 'origin')

  // Lookup from parent id to list of children
  const childLookup = _.object(
    _.map(_.groupBy(_.where(links, { type: 'child' }), 'origin'), function (
      links,
      origin
    ) {
      return [origin, _.pluck(links, 'target')]
    })
  )

  return adjacentGroupBy(people, function (a, b) {
    // Is partner
    return (
      (partnerLookup[a] && partnerLookup[a].target === b) ||
      // Or is co-parent of children (but has no extra with anyone else)
      (includeDefactoPartners &&
        childLookup[a] &&
        childLookup[b] &&
        _.difference(childLookup[b], childLookup[a]).length === 0)
    )
  })
}

// Walk a set of links breadth first starting at a given node
// (specified as an id). Call the mapper for each link.
function walkLinks(start, links, linkFn, nodeFn) {
  if (_.isArray(start)) {
    start = _.clone(start)
  } else {
    start = [start]
  }

  assert(start.length > 0, 'Need at least one start node')
  assert(_.isArray(links), 'Links should be an array')

  const queue = start
  const seen = {}
  let current
  const targetLookup = _.groupBy(links, 'target')
  const originLookup = _.groupBy(links, 'origin')
  _.each(start, function (node) {
    seen[node] = true
  })

  function followLink(link) {
    const other = link.origin === current ? link.target : link.origin

    // console.log('Follow link ' + link.type  + ' from ' + current + ' to ' + other);
    if (linkFn) linkFn(link, current, other, link.origin !== current)
    if (!seen[other]) {
      seen[other] = true
      queue.push(other)
    }
  }

  while (queue.length > 0) {
    current = queue.shift()
    if (nodeFn) nodeFn(current)
    const currentLinks = (targetLookup[current] || []).concat(
      originLookup[current] || []
    )
    currentLinks.forEach(followLink)
  }
}

//
// Ranks (top to bottom ordering)
//

// Find ranks (aka generations, aka vertical position). Takes a
// startNode id (from which we start a breadth first search of the
// links) and a list of links ([{origin, target, type}])
//
// Returns an array of arrays: ret[0..max rank][0..nodes in rank]
// NOTE: Order of nodes within rank isn't significant at this stage
function assignRanks(focusNode, links) {
  assert(_.isString(focusNode), 'focusNode should be an string')
  assert(_.isArray(links), 'Links should be an array')

  if (TRACE) console.groupCollapsed(`assignRanks (focusNode=${focusNode})`)
  const ranks = []

  function rankFrom(startNode) {
    const nodeRank = {}
    const rankNode = {}
    let minRank = 0
    nodeRank[startNode] = 0
    rankNode[0] = {}
    rankNode[0][startNode] = true
    walkLinks(startNode, links, function (link, current, other, reverse) {
      let r
      if (link.type === 'child') {
        r = nodeRank[current] + (reverse ? -1 : +1)
      } else if (link.type === 'partner') {
        r = nodeRank[current]
      } else {
        throw new Error('Unknown link type')
      }

      if (_.isUndefined(nodeRank[other])) {
        if (TRACE)
          console.log(
            `${current}(${nodeRank[current]}) -[${link.type}]-${
              reverse ? '< ' : '> '
            }${other}(${r})`
          )
        nodeRank[other] = r
        ;(rankNode[r] = rankNode[r] || [])[other] = true
        minRank = Math.min(r, minRank)
      } else if (r !== nodeRank[other]) {
        // Non-matching new ranks
        // TODO: Mark the link as non-drawable
        // alert("boom");
        console.log(r, nodeRank[other], other)
      }
    })

    for (let r = minRank; !_.isUndefined(rankNode[r]); r++) {
      const index = r - minRank
      ranks[index] = (ranks[index] || []).concat(_.keys(rankNode[r]))
    }
  }

  let nodesToCheck = _.pluck(links, 'origin')

  while (true) {
    rankFrom(focusNode)

    // Are there any nodes that don't have rank yet (happens when
    // there are multiple disconnected trees)
    nodesToCheck = _.difference(nodesToCheck, _.flatten(ranks))
    if (nodesToCheck.length > 0) {
      focusNode = nodesToCheck[0]
    } else {
      break
    }
  }

  if (TRACE) console.groupEnd()

  return ranks
}

//
// Vertext ordering (left to right order)
//

// Take a proposed ordering for the graph and a set of links and
// return the number of edge crossing (eg the number of times the
// lines between the boxes cross over eachother)
//
// Orders is a 2 dimension array: orders[0...max rank][0..max node in rank] = id
//
// Links is [[originid, targetid]]. An array of id pairs of links
// going from parent to child (partner relations can also be included
// but will be ignored)
//
// NOTE: Links should have been pre-processed so that where there
// would have been links to both members of a couple it instead only
// includes the link to the left hand member (the man in heterosexual
// couples, the arbitrarily choosen left hand partner in same sex
// couples)
//
// This is something like O(n*n) on the rank sizes. Going to see if it
// matters before spending time fixing it.
function crossings(order, links) {
  let crossingsCount = 0

  assert(_.isArray(order), 'Order should be an array')
  assert(_.isArray(links), 'Links should be an array')

  const linksLookup = _.indexBy(links, function (link) {
    return `${link.origin};${link.target}`
  })

  if (TRACE) console.groupCollapsed('crossings')

  _.each(
    _.zip(_.initial(order), _.rest(order)),
    splat(function (rowA, rowB) {
      // Get all links that go from this row and get the origin and
      // target indices
      const rowLinks = _.compact(
        _.map(links, function (l) {
          let originIndex
          let targetIndex
          originIndex = _.indexOf(rowA, l.origin)
          if (originIndex !== -1) {
            targetIndex = _.indexOf(rowB, l.target)
            if (targetIndex !== -1) {
              return [originIndex, targetIndex, l]
            }
          }
        })
      )

      _.each(
        rowLinks,
        splat(function (originA, targetA, linkA, rowIndex) {
          if (TRACE)
            console.groupCollapsed(
              'Considering link ',
              linkA.origin,
              ' to ',
              linkA.target
            )
          const crossesWith = {}
          _.each(
            _.rest(rowLinks, rowIndex + 1),
            splat(function (originB, targetB, linkB) {
              if (
                (originA > originB && targetA < targetB) ||
                (originA < originB && targetA > targetB)
              ) {
                if (
                  linksLookup[`${linkA.origin};${linkB.target}`] &&
                  linksLookup[`${linkB.origin};${linkA.target}`]
                ) {
                  // All interlinked (probably links to both parents from
                  // multiple siblings) so this shouldn't count as a cross
                  if (TRACE)
                    console.log(
                      'Crosses with link ',
                      linkB.origin,
                      ' to ',
                      `${linkB.target} HOWEVER is interlinked so not counting`
                    )
                } else {
                  if (TRACE)
                    console.log(
                      'Crosses with link ',
                      linkB.origin,
                      ' to ',
                      linkB.target
                    )

                  // crossingsCount++;
                  crossesWith[linkB.target] = true
                }
              } else if (TRACE) console.log("Doesn't cross with link ", linkB.origin, ' to ', linkB.target)
            })
          )
          if (TRACE) console.groupEnd()
          if (TRACE) console.log(`Crossed with ${_.size(crossesWith)} links`)
          crossingsCount += _.size(crossesWith)
        })
      )
    })
  )

  if (TRACE) console.log('crossings = ', crossingsCount)
  if (TRACE) console.groupEnd()
  return crossingsCount
}

function sortByWeights(ranks, weights) {
  assert(_.isArray(ranks), 'ranks should be an array')
  assert(_.isObject(weights), 'weights should be an object')

  return _.map(ranks, function (row) {
    return _.sortBy(row, function (id) {
      return weights[id]
    })
  })
}

// Calculate an initial order for nodes within ranks based on a
// breadth-first search starting from rank 0
function breadthFirstOrder(ranks, links, fromBottom) {
  assert(_.isArray(ranks), 'ranks should be an array')
  assert(_.isArray(links), 'weights should be an array')

  let currentWeight = 0
  const initialWeights = {}
  walkLinks(fromBottom ? _.last(ranks) : ranks[0], links, null, function (
    node
  ) {
    if (!(node in initialWeights)) {
      initialWeights[node] = currentWeight++
    }
  })

  // console.log(initialWeights);
  return sortByWeights(ranks, initialWeights)
}

// Ensure that couples are placed next to each other. Assumes links
// point from left to right (eg from man to woman in a hetrosexual
// relationship if you want the traditional family tree ordering)
function cupid(order, links) {
  assert(_.isArray(order), 'order should be an array')
  assert(_.isArray(links), 'weights should be an array')

  if (TRACE) console.groupCollapsed('cupid')

  const partnerLinks = _.indexBy(_.where(links, { type: 'partner' }), 'origin')
  const weights = {}
  _.each(order, function (row) {
    _.each(row, function (id, i) {
      const partner = partnerLinks[id]
      if (!(id in weights)) {
        weights[id] = i
      }
      if (partner) {
        weights[partner.target] = weights[id] + 0.5
      }
    })
  })
  order = sortByWeights(order, weights)

  if (TRACE) console.groupEnd()
  return order
}

// In place sort the given items using weights supplied as a lookup
// table. Items which don't have a weight won't be moved
// !!!!!MUTATES items!!!!!!
function partialWeightSort(items, weights, swapWhenEqual) {
  assert(_.isArray(items), 'items should be an array')
  assert(_.isObject(weights), 'weights should be an object')

  let changed = true
  const hasWeight = function (x) {
    return !_.isUndefined(weights[x])
  }

  // It's a bubbly-good sort!
  while (changed) {
    changed = false
    let firstSortable = findIndex(items, hasWeight)
    while (firstSortable !== -1) {
      const secondSortable = findIndex(items, hasWeight, firstSortable + 1)
      if (secondSortable !== -1) {
        if (weights[items[firstSortable]] > weights[items[secondSortable]]) {
          swap(items, firstSortable, secondSortable)
          changed = true
        } else if (
          swapWhenEqual &&
          weights[items[firstSortable]] === weights[items[secondSortable]]
        ) {
          swap(items, firstSortable, secondSortable)
        }
        firstSortable = secondSortable
      } else {
        break
      }
    }
  }
}

// See [TDDG] Figure 3-2
function wmedian(order, links, topToBottom, swapWhenEqual) {
  assert(_.isArray(order), 'order should be an array')
  assert(_.isArray(links), 'links should be an array')
  assert(_.isBoolean(topToBottom), 'topToBottom should be a boolean')

  if (TRACE)
    console.groupCollapsed(
      `wmedia (topToBottom=${topToBottom}, swapWhenEqual=${swapWhenEqual})`
    )

  let linksLookup
  let pairs
  const partnerLinks = _.indexBy(_.where(links, { type: 'partner' }), 'origin')

  // Make a copy of order because we're going to mutate it
  order = _.map(order, _.clone)

  // console.log('TOP TO BOTTOM', topToBottom);
  if (topToBottom) {
    linksLookup = _.indexBy(links, function (link) {
      return `${link.origin};${link.target}`
    })
    pairs = _.zip(_.rest(order), _.initial(order))
  } else {
    linksLookup = _.indexBy(links, function (link) {
      return `${link.target};${link.origin}`
    })
    pairs = _.zip(_.initial(order), _.rest(order))
    pairs.reverse()
  }

  _.each(
    pairs,
    splat(function (current, adjacent) {
      const medians = {}

      // console.log(current, adjacent, linksLookup);

      _.each(current, function (nodeId) {
        medians[nodeId] = medianValue(
          adjPositions(nodeId, adjacent, linksLookup),
          true
        )

        // console.log('m', nodeId, medians[nodeId]);
      })

      // Give partners the same weights as eachother
      _.each(current, function (nodeId) {
        if (
          partnerLinks[nodeId] &&
          _.contains(current, partnerLinks[nodeId].target)
        ) {
          const partner = partnerLinks[nodeId].target
          if (_.isUndefined(medians[nodeId])) {
            medians[nodeId] = medians[partner]
          } else if (_.isUndefined(medians[partner])) {
            medians[partner] = medians[nodeId]
          } else {
            // Originally was setting the value to the average of the
            // two partners but on further reflection this is likely to
            // give the worst of both worlds. Considered randomly
            // choosing a partner but that sounds like it wouldn't be
            // too nice either. So just picking the left partner and
            // using the value from that

            // medians[nodeId] = medians[partner] = (medians[nodeId] + medians[partner]) / 2;
            medians[partner] = medians[nodeId]
          }
        }
      })

      // MUTATES CURRENT!!
      partialWeightSort(current, medians, swapWhenEqual)
    })
  )

  if (TRACE) console.groupEnd()

  return order
}

// Only called from wmedian, get the positions of the linked to nodes
// in the adjancent row
function adjPositions(nodeId, adjacent, linksLookup) {
  assert(_.isString(nodeId), 'nodeId should be a string')
  assert(_.isArray(adjacent), 'adjacent should be an array')
  assert(_.isObject(linksLookup), 'linksLookup should be an object')

  return _.chain(adjacent)
    .map((adjId, index) =>
      linksLookup[`${adjId};${nodeId}`] ? index : undefined
    )
    .filter(_.negate(_.isUndefined))
    .value()
}

// Only called from wmedian, take the list of adjacent node positions
// and return the median weighted value (see [TDDG] for an explanation)
function medianValue(P, packWeighted) {
  assert(_.isArray(P), 'P should be an array')

  const Pl = P.length
  const m = Math.floor(Pl / 2)

  if (Pl === 0) {
    return null
  }

  if (Pl % 2 === 1) {
    return P[m]
  }

  if (Pl === 2) {
    return (P[0] + P[1]) / 2
  }

  if (packWeighted) {
    const left = P[m - 1] - P[0]
    const right = P[Pl - 1] - P[m]
    return (P[m - 1] * right + P[m] * left) / (left + right)
  }

  return (P[m - 1] + P[m]) / 2
}

// Transpose nodes and check if it improves things
// See Figure 3-3 in [TDDG].
function transpose(order, links, swapWhenEqual) {
  assert(_.isArray(order), 'order should be an array')
  assert(_.isArray(links), 'links should be an array')

  if (TRACE)
    console.groupCollapsed(`transpose (swapWhenEqual=${swapWhenEqual})`)

  let improved = true
  let bestCrossings = crossings(order, links)
  const leftPartner = _.indexBy(_.where(links, { type: 'partner' }), 'origin')
  const rightPartner = _.indexBy(_.where(links, { type: 'partner' }), 'target')

  if (TRACE) console.log('Crossings before transpose', bestCrossings)

  function transposeIteration(row, rowIndex) {
    if (TRACE) console.log('Consider row:', row)
    _.times(row.length - 1, function (i) {
      const newRow = _.clone(row)

      // TODO: Should we detect when transpose would put the item
      // into the middle of a partner relationship and transpose to
      // +2 instead?
      if (leftPartner[newRow[i + 1]] && newRow[i + 2]) {
        if (TRACE)
          console.log(
            'Keeping ',
            newRow[i + 1],
            ' and ',
            newRow[i + 2],
            ' as a couple and looking at swapping with',
            newRow[i]
          )
        swap(newRow, i, i + 1)
        swap(newRow, i + 1, i + 2)
      } else if (rightPartner[newRow[i]] && newRow[i - 1]) {
        if (TRACE)
          console.log(
            'Keeping ',
            newRow[i - 1],
            ' and ',
            newRow[i],
            ' as a couple and looking at swapping with',
            newRow[i + 1]
          )
        swap(newRow, i, i + 1)
        swap(newRow, i - 1, i)
      } else {
        if (TRACE)
          console.log('Looking at swapping', newRow[i], 'with', newRow[i + 1])
        swap(newRow, i, i + 1)
      }
      const newOrder = _.clone(order)
      newOrder[rowIndex] = newRow
      const c = crossings(newOrder, links)
      if (c < bestCrossings) {
        if (TRACE)
          console.log('SWAPPED giving crossings of ', c, '<', bestCrossings)
        bestCrossings = c
        improved = true

        row = newRow
        order[rowIndex] = row
      } else if (c === bestCrossings && swapWhenEqual) {
        if (TRACE)
          console.log(
            'SWAPPED (even though equal) giving crossings of ',
            bestCrossings
          )

        row = newRow
        order[rowIndex] = row
      } else {
        // TOOD: [TDDG] suggests that swapping even if crossing are
        // equal (but only one every other up or down pass) can
        // improve things (page 17)

        if (TRACE)
          console.log(
            'DID NOT SWAP it would have given crossings of ',
            c,
            '>=',
            bestCrossings
          )
      }
    })
  }

  order = _.map(order, _.clone)
  while (improved) {
    improved = false
    if (TRACE) console.log('Trying a round transposes')
    _.each(order, transposeIteration)
  }
  if (TRACE) console.groupEnd()
  return order
}

// Take an order that has already been assigned ranks (but for which
// the row order is random) and order the rows
const ORDERING_ITERATIONS = 6
function assignRowOrder(order, links, fromBottom) {
  assert(_.isArray(order), 'order should be an array')
  assert(_.isArray(links), 'links should be an array')

  order = breadthFirstOrder(order, links, fromBottom)
  order = cupid(order, links)

  let best = order
  let bestCrossings = crossings(best, links)
  if (TRACE) console.log('Crossing for initial order', bestCrossings)

  // TODO: Exit early if things aren't getting better?
  _.times(ORDERING_ITERATIONS, function (i) {
    const reverse = i % 2 === 0
    const swapWhenEqual = Math.floor(i / 2) % 2 === 0
    order = wmedian(order, links, reverse, swapWhenEqual)
    order = transpose(order, links, swapWhenEqual)
    order = cupid(order, links)
    const c = crossings(order, links)
    if (c < bestCrossings) {
      if (TRACE) console.log('Better order found', c, '<', bestCrossings)
      bestCrossings = c
      best = order

      // } else if (c === bestCrossings && swapWhenEqual) {
      //   if (TRACE) console.log('Swapping with equal cost order', c);
      //   best = order;
    } else if (TRACE) console.log('Order was not better', c, '>=', bestCrossings)
  })
  return best
}

const ORDERING_ATTEMPS = 5
function ordering(startId, links) {
  assert(_.isString(startId), 'startId should be an string')
  assert(_.isArray(links), 'links should be an array')

  if (TRACE) console.groupCollapsed('ordering')

  const ranks = assignRanks(startId, links)
  let best
  let bestCrossings
  bestCrossings = Number.MAX_VALUE

  function tryOrdering(fromBottom) {
    if (TRACE)
      console.groupCollapsed(
        `Trying with initial order from from ${fromBottom ? 'bottom' : 'top'}`
      )
    const order = assignRowOrder(ranks, links, fromBottom)
    const c = crossings(order, links)
    if (TRACE) console.log('Crossings=', c)
    if (c < bestCrossings) {
      best = order
      bestCrossings = c
    }
    if (TRACE) console.groupEnd()
  }

  for (let i = 0; i < ORDERING_ATTEMPS; i++) {
    tryOrdering(true)
    if (bestCrossings === 0) break
    tryOrdering(false)
    if (bestCrossings === 0) break
    if (TRACE)
      console.log(
        "Didn't find perfect layout so trying again with different starting conditions"
      )
    links = _.shuffle(links)
  }

  if (TRACE) console.groupEnd()
  if (TRACE) console.log('Best Crossings=', bestCrossings)

  return best
}

//
// Node coordinates
//

function centeredOn(center, nodes, spacingFn) {
  // We want a bigger gap between partners than between
  // non-partners (to fit the partner line)
  const spacing = [0].concat(
    _.map(_.zip(_.initial(nodes), _.rest(nodes)), splat(spacingFn))
  )
  let xposition = center - sum(spacing) / 2
  return _.map(
    _.zip(nodes, spacing),
    splat(function (nodeId, width) {
      xposition += width
      return xposition
    })
  )
}

function layoutSubTree(order, links, coupleSpacingMultiplier) {
  assert(_.isArray(order), 'order should be an array')
  assert(_.isArray(links), 'links should be an array')

  if (TRACE)
    console.groupCollapsed(`layoutSubTree (remaining depth=${order.length})`)

  const partnerLookup = _.indexBy(_.where(links, { type: 'partner' }), 'origin')
  const linksLookup = _.indexBy(links, function (link) {
    return `${link.origin};${link.target}`
  })

  order = _.map(order, _.clone)
  const row = order[0]
  const remainingRows = _.rest(order)

  function subTree(group, children, firstChildIndex, trailingPartnerCount) {
    if (TRACE) console.log(`Children (${children.length}): ${children}`)

    let placements
    if (children.length > 0) {
      // What about already placed nodes?

      // Placements is like order but only some subset of the leftmost entries
      placements = layoutSubTree(
        [children].concat(_.rest(remainingRows, 1)),
        links,
        coupleSpacingMultiplier
      )

      // Strip out already placed items
      _.each(
        _.zip(remainingRows, placements),
        splat(function (rem, place) {
          rem.splice(0, place.length)
        })
      )
    } else {
      placements = _.map(remainingRows, function () {
        return []
      })
    }

    // Add positions for group to the results for the current row
    // (eg place the parents in the center of there children)
    let center
    if (placements.length && placements[0].length) {
      // While we include trailing partners for the purposes of
      // total position we should ignore them for the purposes of
      // the finding the center
      const min = _.min(_.rest(placements[0], firstChildIndex))
      const max = _.max(_.initial(placements[0], trailingPartnerCount))
      center = (max - min) / 2 + min
    } else {
      center = 0
    }
    if (TRACE) console.log(`Center=${center}`)

    placements.unshift(
      centeredOn(center, group, (nodeA, nodeB) => {
        return partnerLookup[nodeA] && partnerLookup[nodeA].target === nodeB
          ? coupleSpacingMultiplier
          : 1
      })
    )

    // Fit the sub-tree as far left as possible
    const plusx = _.max(
      _.map(
        _.zip(minx, placements),
        splat((mx, place) => {
          return place.length ? mx - place[0] : Number.NEGATIVE_INFINITY
        })
      )
    )

    // Alternative version that gives a less compact version
    // var plusx = _.max(minx) - _.min(_.flatten(placements));

    // Apply minimum x and add to results for the child rows (MUTATES RESULTS)
    _.each(
      _.zip(results, placements),
      splat(function (res, place) {
        _.each(place, function (p) {
          res.push(p + plusx)
        })
      })
    )

    // Figure out minimum x values for each row from now on. Add 10%
    // to the child rows (so non-siblings aren't right next to
    // eachother)
    minx = _.map(results, (res, index) => {
      return res.length ? _.last(res) + (index === 0 ? 1 : 1.1) : 0
    })

    if (TRACE) console.log(`minx=${minx}`)
    if (TRACE) console.groupEnd()
  }

  let results
  if (remainingRows.length === 0) {
    // For leaf rank we just assign position=index
    if (TRACE) console.log('Leaf rank')
    results = [_.range(row.length)]
  } else {
    results = _.map(order, function () {
      return []
    })
    const grouped = partnerGroups(row, links, true)
    var minx = _.map(order, _.constant(0))
    _.each(grouped, function (group) {
      if (TRACE) console.groupCollapsed(`Consider ${group}`)
      function isChild(childId) {
        if (group.length === 0) return true
        return _.any(group, function (parentId) {
          return linksLookup[`${parentId};${childId}`]
        })
      }
      const lastChildIndex = findLastIndex(remainingRows[0], isChild)
      const firstChildIndex = findIndex(remainingRows[0], isChild)

      // Include trailing partners
      let lastChildPlusPartner = lastChildIndex
      let trailingPartnerCount = 0
      while (
        lastChildPlusPartner < remainingRows[0].length - 1 &&
        partnerLookup[remainingRows[0][lastChildPlusPartner]] &&
        partnerLookup[remainingRows[0][lastChildPlusPartner]].target ===
          remainingRows[0][lastChildPlusPartner + 1]
      ) {
        lastChildPlusPartner++
        trailingPartnerCount++
      }

      // ALL NODES UP TO THE LAST NODE THAT IS A CHILD (OR PARTNER OF CHILD) OF THE PARENT GROUP
      const children = remainingRows[0].slice(0, lastChildPlusPartner + 1)

      subTree(group, children, firstChildIndex, trailingPartnerCount)
    })
  }
  if (TRACE) console.groupEnd()
  return results
}

// Can we improve the layout be pushing any node left?
function compactLeft(order, xcoords, links) {
  let improvement = true
  xcoords = _.clone(xcoords)

  const childLookup = _.mapObject(
    _.groupBy(_.where(links, { type: 'child' }), 'origin'),
    (links) => _.pluck(links, 'target')
  )

  function compactRow(row) {
    const groups = partnerGroups(row, links, true)
    _.each(
      _.zip(_.initial(groups), _.rest(groups)),
      splat(function (prevGroup, group) {
        // Would moving this group back a bit improve things?
        const min = xcoords[_.last(prevGroup)] + 1.1
        let newx
        const children = _.intersection.apply(
          this,
          _.map(group, _.propertyOf(childLookup))
        )
        if (children.length) {
          const center =
            sum(_.map(children, _.propertyOf(xcoords))) / children.length
          const groupWidth = xcoords[_.last(group)] - xcoords[_.first(group)]
          newx = Math.max(min, center - groupWidth / 2)
        } else {
          // Don't move children
          return
        }

        if (newx < xcoords[group[0]]) {
          const change = newx - xcoords[group[0]]
          _.each(group, function (node) {
            xcoords[node] += change
          })
          improvement = true
        }
      })
    )
  }

  while (improvement) {
    improvement = false
    _.each(order, compactRow)
  }
  return xcoords
}

function xcoordinates(order, links, coupleSpacingMultiplier) {
  // HACK: add a phantom entry to each rank who is aparent to all
  // the people below. This fixes the issue where we only look over
  // the follow row for the first one, after that we assume that
  // each item in each row will be connected via a child or partner
  // relationship. It would be nice to fix this in a less hacky way
  // but this works for now!
  links = _.clone(links)
  order = _.map(order, function (row) {
    _.each(row, function (id) {
      links.push({ origin: '__PHANTOM__', target: id, type: 'child' })
    })
    return row.concat(['__PHANTOM__'])
  })
  links.push({ origin: '__PHANTOM__', target: '__PHANTOM__', type: 'child' })

  const results = layoutSubTree(order, links, coupleSpacingMultiplier || 1)
  let xcoords = _.object(_.zip(_.flatten(order), _.flatten(results)))
  xcoords = compactLeft(order, xcoords, links)
  return xcoords
}

//
// Lines
//

function getLines(order, links, coords, lineVSpacing) {
  // Lines between partners
  const partnerLines = _.map(_.where(links, { type: 'partner' }), function (
    link
  ) {
    return {
      x1: coords[link.origin].x,
      y1: coords[link.origin].y,
      x2: coords[link.target].x,
      y2: coords[link.target].y,
      type: 'partner',
    }
  })

  // Lines between parents and children
  const partnerLookup = _.indexBy(_.where(links, { type: 'partner' }), 'origin')

  const childLines = _.flatten(
    _.map(
      _.zip(_.initial(order), _.rest(order)),
      splat(function (parentRow, childRow) {
        const grouped = partnerGroups(parentRow, links, true)

        // Assumes that groups are all of size 1 or 2 (LOOK HERE IF YOU
        // IMPLEMENT EX-RELATIONSHIPS ETC)
        const parentConnections = _.flatten(
          _.map(grouped, function (group) {
            let targetIds
            let xOrigins
            const leftPartner = group[0]
            const rightPartner = group[1]

            // rightPartner will often be undefined (eg a single person)
            const leftChildren = _.pluck(
              _.where(links, { type: 'child', origin: leftPartner }),
              'target'
            )
            if (rightPartner) {
              const rightChildren = _.pluck(
                _.where(links, { type: 'child', origin: rightPartner }),
                'target'
              )

              // If a child is in both left and right then we move them to
              // center (eg they're a child of the couple)
              const centerChildren = _.intersection(leftChildren, rightChildren)

              // Are they actual partners (eg in a relationship) not just
              // defacto partners (becasue of shared children)
              const actualPartners =
                partnerLookup[leftPartner] &&
                partnerLookup[leftPartner].target === rightPartner
              targetIds = [
                _.difference(leftChildren, centerChildren),
                centerChildren,
                _.difference(rightChildren, centerChildren),
              ]
              const lx = coords[leftPartner].x
              const rx = coords[rightPartner].x
              let centerOrigins
              if (actualPartners) {
                // If the partners are actually in a relationship then we
                // want the stalk coming down from the middle of that
                centerOrigins = [(lx + rx) / 2]
              } else {
                // Otherwise they need two individual stalks
                centerOrigins = [lx, rx]
              }

              xOrigins = [[lx], centerOrigins, [rx]]
            } else {
              targetIds = [leftChildren]
              xOrigins = [[coords[leftPartner].x]]
            }

            return _.map(
              _.zip(targetIds, xOrigins),
              splat(function (tids, originxs) {
                if (tids.length === 0) return []
                const targetxs = _.map(tids, (id) => coords[id].x)
                return {
                  // debug: tids,
                  minx: Math.min(_.min(originxs), _.min(targetxs)),
                  maxx: Math.max(_.max(originxs), _.max(targetxs)),
                  originxs,
                  targetxs,
                }
              })
            )
          })
        )

        // Find the adjancent groups that can be merged (all the same
        // children, happens for parents who are not partners)
        const mergeableParentConnections = adjacentGroupBy(
          parentConnections,
          function (conna, connb) {
            return _.isEqual(conna.targetxs, connb.targetxs)
          }
        )
        const mergedParentConnections = _.map(
          mergeableParentConnections,
          function (conns) {
            return {
              minx: _.min(_.pluck(conns, 'minx')),
              maxx: _.max(_.pluck(conns, 'maxx')),
              originxs: _.union.apply(null, _.pluck(conns, 'originxs')),
              targetxs: _.union.apply(null, _.pluck(conns, 'targetxs')),
            }
          }
        )

        // Group all the runs of overlapping lines
        const groupedParentConnections = adjacentGroupBy(
          mergedParentConnections,
          function (conna, connb) {
            return conna.maxx >= connb.minx
          }
        )

        const originY = coords[parentRow[0]].y
        const targetY = coords[childRow[0]].y
        const midY = (originY + targetY) / 2
        return _.map(groupedParentConnections, function (connectionGroup) {
          return _.map(connectionGroup, function (conn, connIndex) {
            const y =
              midY -
              ((connectionGroup.length - 1) / 2 - connIndex) * lineVSpacing

            // console.log(conn.debug, y, ((connectionGroup.length-1)/2-connIndex)*lineVSpacing, conn.targetxs.length);
            return [
              // Upper stalks
              _.map(conn.originxs, function (ox) {
                return { x1: ox, y1: originY, x2: ox, y2: y, type: 'child' }
              }),

              // Horizontal line
              { x1: conn.minx, y1: y, x2: conn.maxx, y2: y, type: 'child' },

              // Lower stalks
              _.map(conn.targetxs, function (tx) {
                return { x1: tx, y1: y, x2: tx, y2: targetY, type: 'child' }
              }),
            ]
          })
        })
      })
    )
  )

  return _.flatten([partnerLines, childLines])
}

//
// All together now
//

function layout(
  startId,
  links,
  nodeWidth,
  minHSpacing,
  partnerHSpacing,
  rankHeight,
  lineVSpacing
) {
  // var order = ordering(startId, normaliseLinks(links));
  const order = ordering(startId, links)
  const xcoords = xcoordinates(
    order,
    links,
    (nodeWidth + partnerHSpacing) / (nodeWidth + minHSpacing)
  )

  const coords = {}
  _.each(order, (row, rank) => {
    _.each(row, (id) => {
      coords[id] = {
        x: xcoords[id] * (nodeWidth + minHSpacing) + nodeWidth / 2,
        y: rank * rankHeight + rankHeight / 2,
      }
    })
  })

  const lines = getLines(order, links, coords, lineVSpacing)

  return { nodes: coords, lines }
}

export default {
  layout,

  // Exported to allow unit testing, DO NOT USE FOR ANYTHING ELSE
  _private: {
    crossings,
    assignRanks,
    breadthFirstOrder,
    cupid,
    partialWeightSort,
    wmedian,
    transpose,
    xcoordinates,
    ordering,
  },
}
