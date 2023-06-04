module.exports = (_=>{
  const makePact = _=> ({dooms:[], barriers:[0], restores:[]})
  function Vessel(flow, stack, logger) {
    const result = {
      prev:null,
      extra:null,
      flows:[],
      flowBarriers:[0],
      logger,
      log: function(...args) {
        if(typeof this.logger.func == 'function') {
          let msg = args.join(', ') + '\n'
          const debug = this.flow.code[this.flow.start-1].debug
          if(debug)
            msg = String(debug.line).padStart(4,' ') + ':' + String(debug.start).padStart(4,' ') + '-' + String(debug.end).padStart(4,' ') + ' ' + msg
          this.logger.func(msg)
        }
      },
      pushFlow:function(scopes, stack, flow, resultCount, disjoined) {
        if(disjoined)
          this.flowBarriers.push(this.flows.length+1)
        this.flows.push(this.flow)
        if(!flow.code)
          flow = {func:flow}
        this.makeFlow(scopes, resultCount, stack, flow, disjoined ? makePact() : flow.pact ?? this.flow.pact, a => this.flow = a)
        this.flow.scopes.splice(0,0,...scopes)
      },
      popFlow:function(arr, terminate) {
        if(this.flow.flows && !terminate)
          this.flows.push(...this.flow.flows)
        while(this.flows.at(-1)?.func)
          this.flows.pop().func()
        const flow = this.flows.pop()
        if(flow == null) {
          this.results = arr
        } else {
          const result = this.flow
          this.flow = flow
          this.flow.stack.push(...arr)
          return result
        }
      },
      run:function() {
        if(this.flow.code) {
          this.flow.run(this)
          if(this.results)
            return true
        } else {
          const flow = this.flow
          this.flow = this.flows.pop()
          let func = flow.func
          if(flow.scopes.length)
            func = func.bind(flow.scopes.at(-1))
          if(typeof func != 'function')
            throw 'not a function: ' + func
          flow.stack = [func(...flow.stack)]
          const r = []
          for(const pos of flow.resultCount)
            r.push(flow.stack.at(pos))
          this.flow.stack.push(...r.reverse())
        }
      },
      makeFlow: function(scopes, resultCount, stack, flow, pact, callback) {
        if(!flow.timeTravel)
          flow = {scopes, resultCount, stack, ...flow, pact} 
        callback({stackBarriers:[0], stack:[], temporaries:{}, ...flow, debugDetails:{},
          stage:{obj:[], arg:[]},
          push: function(val) {
            this.stack.push(val)
          },
          debugDetail: function(name, val){
            this.debugDetails[name] = val
          },
          insert: function(val, pos) {
            if(pos == null)
              pos = this.stack.length
            this.stack.splice(pos, 0, val)
          },
          pop: function() {
            if(this.stack.length <= this.stackBarriers.at(-1))
              this.throw('over-pop')
            else
              return this.stack.pop()
          },
          peek: function() {
            if(this.stack.length <= this.stackBarriers.at(-1))
              this.throw('over-pop')
            else
              return this.stack.at(-1)
          },
          flatCmd: function(noPos) {
            return (noPos ? '' : this.start-1 + ' ') + flatten([this.code[this.start-1]])
          },
          splice: function(...args) {
            if(args[0] > 0) {
              if(args[0] < this.stackBarriers.at(-1))
                this.throw('over-pop')
            } else if(this.stack.length-args[0] < this.stackBarriers.at(-1))
              this.throw('over-pop')
            return this.stack.splice(...args)
          },
          throw: function(msg, detail) {
            throw {pos:this.start-1, msg, cmd:this.flatCmd(true), detail}
          },
          run: function(vsl) {
            if(this.start == this.end) {
              elements[cmdIndex('return')][1](this, vsl)
            } else {
              if(this.start >= this.code.length || this.start < 0)
                throw `position out of range: ${this.start} out of ${this.code.length} and not ${this.end}\nCode: ${flatten(this.code, true)}`
              const [cmd, ...args] = this.code[this.start++]
              if(vsl.logger.logCmds)
                vsl.log(this.flatCmd(true) + (vsl.logger.logStack ? ' ' + this.stack.length : ''))
              elements[cmd][1](this, vsl,...args)
            }
          },
        })
        if(flow.timeTravel) {
          while(flow.pact.restores.length && flow.pact.restores.at(-1)[1] > flow.start)
            flow.pact.restores.pop()
          if(flow.pact.restores.at(-1)[1] != flow.start)
            this.throw('start not on restores')
          while(flow.pact.dooms.length > flow.pact.restores.at(-1)[0])
            this.pushFlow([], ...flow.pact.dooms.pop())
          flow.stack.splice(flow.stackBarriers.at(-1), Infinity, ...stack)
        }
      },
    }
    result.makeFlow([{}], null, stack, flow, flow.pact ?? makePact(), a => result.flow = a)
    return result
  }
  function consume(str) {
    const spell = []
    const push = (...item) => {
      item[0] = cmdIndex(item[0])
      item.debug = {line:lineCount, start:wordStart, end:c}
      if(item != null)
        spell.push(item)
      return item
    }
    let labelCount = 0
    const addLabel = cmd => cmd.push(push('label', labelCount++))
    const loopStack = []
    const loopStarts = []
    const loopEnds = []
    const branches = []
    const branchEnds = []
    const switchStack = []
    const containers = [[]]
    const wordEnds = []
    const husks = [{containers:null, ends:[]}]
    const hungValCount = []
    const snippets = []
    let discard
    let terminate = false
    const addLabels = stack => {
      for(let cmd of stack.pop())
        addLabel(cmd)
    }
    const pushSave = (stack, ...item) => {
      item = push(...item)
      stack.push(item)
      return item
    }
    const constants = {true:true, false:false, NaN:NaN, Infinity:Infinity, null:null}
    const multiBranch = {
      ';;':function() {
        this.cmd[1] = push('label', labelCount++)
      },
      single:false,
    }
    
    const singleBranches = {
      '&#': {
        ',':function() {
          push('contain')
          pushSave(this.branches, 'goifnot')
          push('prev')
        },
        ';':function() {
          while(this.branches.length)
            addLabel(this.branches.pop())
        },
      },
      '&': {
        ',':function() {
          pushSave(this.branches, 'goifnot')
        },
        ';':function() {
          while(this.branches.length)
            addLabel(this.branches.pop())
        },
      },
      '|': {
        ',':function() {
          pushSave(this.branches, 'goif')
        },
        ';':function() {
          if(!this.branches.length)
            return
          const cmd = this.branches.pop()
          addLabel(cmd)
          if(this.branches.length) {
            cmd[0] = cmdIndex('goifnot')
            const label = [cmdIndex('label'), labelCount++]
            spell.splice(spell.indexOf(cmd)+1, 0, label)
            while(this.branches.length)
              this.branches.pop().push(label)
          } else return true
        },
      },
    }
    for(const name in singleBranches)
      singleBranches[name][';;'] = singleBranches[name][';']
    const multiBranches = {
      '#': { label:false, push:_=>push('multigoto', null), ',':function() {
        addLabel(this.cmd)
        if(this.keep && !discard)
          push('discard')
      }, ';':function(){addLabel(this.cmd)}},
      '.': { label:true, push:_=>push('switch', null),
        ',':function(name) {
          let tmp
          if(name != null)
            this.cmd.push(name)
          else if(spell.at(-1)[0] == cmdIndex('const'))
            this.cmd.push(tmp = spell.pop()[1])
          else
            throw '"," branch marker without constant value'
          addLabel(this.cmd)
          if(this.keep && discard) {
            push('discard')
          }
        },
      },
    }

    let wordStart = 0
    let lineCount = 0
    let lineStart = 0
    let c = 0
    // Main
    for(; c <= str.length; c++) {
      if(str[c] == '\n') {
        lineCount++
        lineStart = c
      } else if('`' == str[c]) {
        for(; ++c < str.length;)
          if(str[c] == '`' && str[c-1] != '\\')
            break
        if(c == str.length)
          throw 'unclosed "'
        continue
      } else if(c < str.length && str[c] != ' ') continue
      if(c == wordStart) {
        wordStart++
        continue
      }
      let end = c
      let start = wordStart
      const getRest = _=> {
        const result = start < end ? str.slice(start, end) : null
        start = end
        return result
      }
      const getName = _=> {
        checkPrefix('`')
        let end2 = end
        const specials = '`~!@#$%^&*-=+\\|;:<>?,./[]{}()'
        if(!checkSuffix('`'))
          for(; --end > start;)
            if(!specials.includes(str[end]))
              break
        end++
        const name = getRest()
        end = end2
        return name
      }
      const checkSuffix = expected => {
        if(str.slice(start, end).endsWith(expected)) {
          end -= expected.length
          return true
        } return false
      }
      const checkPrefix = expected => {
        if(str.slice(start, end).startsWith(expected)) {
          start += expected.length
          return true
        } return false
      }
      const checkPrefixes = (affixes, callback) => {
        for(const [sign, item] of affixes)
          if(checkPrefix(sign)) {
            callback(item)
            return true
          }
      }
      const checkSuffixes = (affixes, callback) => {
        for(const [sign, item] of affixes)
          if(checkSuffix(sign)) {
            callback(item)
            return true
          }
      }
      const actions = {
        '~>':_=>{
          push('terminate')
        },
        '-*':_=> {
          push("const", -1)
          push('multiply')
        },
        '#':_=> {
          checkHusk('hung', item => {
            const count = item[1]
            for(let i = 0; i < count; i++)
              husks.at(-1).hung.at(-i-1)[0]('access', '.')
          })
        },
        '][':_=>{
          if(!containers.length)
            throw 'over-close []'
          let husk = husks.at(-1)
          addLabel(husk.ends)
          terminate = true
          husk.containers.splice(0,Infinity, _=> {
            addLabel(cmd)
            push('destructor')
          }).forEach(func => func())
          terminate = false
          const cmd = push('husk')
        },
        '##':_=>{
          for(; c <= str.length; c++)
            if(str[c] == '\n') {
              c--
              break
            }
        },
        '=>': _=> {
          terminate = true
          discard = true
          const husk = husks.at(-1)
          for(let i = containers.length; containers[--i] != husk?.containers;) {
            containers[i].forEach(func => {
              if(func.doomed)
                func()
            })
          }
          terminate = false
          pushSave(husk.ends, 'goto')
        },
        ')': _=> loopStack.pop()(loopStarts.pop()),
        ';': _=> {
          pushSave(branchEnds.at(-1), 'goto')
          const branch = branches.at(-1)
          branch?.[';']?.()
          if(branch.keep) {
            //push('discard')
            if(branch.single)
              branch.keep = false
          }
        },
        ';;': _=> {
          pushSave(branchEnds.at(-1), 'goto')
          branches.pop()?.[';;']?.()
          branches.push(null)
        },
      }
      const checkHusk = (name, func) => {
        if(husks.at(-1)[name]?.length)
          func(husks.at(-1)[name].at(-1))
        else
          return true
      }
      const incHusk = (name, ...args) => {
        if(!husks.at(-1)[name])
          husks.at(-1)[name] = []
        const func = (op, prefix) => {
          push('tmps')
          push('const', prefix+num)
          push(op)
        }
        const num = husks.at(-1)[name].push([func, ...args]) -1
        return func
      }
      const detectAccess = (operator, forcedName, arity=2, args=[]) => {
        let argCount = args.length
        let subjects = []
        let seed
        let orphan
        const digits = '1234567890'
        const mark = checkPrefix('()') && push('mark')
        const argPrefixes = [
          ['%', ['extra']], ['.', false],
          [':', ['prev']], ['+', ['const', true]],
          ['-', ['const', false]], ['~', ['const', null]],
        ]
        const subjectPrefixes = [
          [',', false], [';', ['prev']]
        ]
        const newcontainers = {newStack:'', newScope:'@', andSpindle:'&', orSpindle:'|'}
        for(const cmd in newcontainers) {
          argPrefixes.push([`[${newcontainers[cmd]}]`, [cmd]])
          subjectPrefixes.push([`{${newcontainers[cmd]}}`, [cmd]])
        }
        for(let i = start; i < end; i++) {
          if(str[i] == '"')
            args.push(["const", str.slice(start, i)])
          else if(str[i] == '\'') {
            const hex = str.slice(start, i)
            let val = ''
            for (let i = 0; i < hex.length; i += 2)
              val += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
            args.push(['const', val])
          } else continue
          start = i+1
          argCount++
        }
        while(start < end) {
          if(checkPrefix('!')) {
            if(args.length == 0) {
              push('dup')
            }
          } else if(checkPrefixes(argPrefixes, item => args.push(item)));
          else if(checkPrefixes([['[', false], ['>', true]], item=>{
            orphan = item
            args.push('seed')
          }));
          else if(checkPrefixes(subjectPrefixes, (item) => {
            subjects.push(args.length)
            args.push(item)
          }))
            continue
          else if(digits.includes(str[start])) {
            const numStart = start
            while((digits).includes(str[++start]));
            args.push(['const', Number(str.slice(numStart, start))])
          } else if(checkPrefix('&')) {
            if(argCount == -1)
              throw 'double &'
            argCount = -1
            const botArgs = args.splice()
            for(let a = 0; a < botArgs.length; a++) {
              if(args[p] == false) continue
              botArgs[a].push(a)
              push(botArgs[a])
            }
          } else
            break
          if(argCount >= 0)
            argCount++
        }
        let stackScopes = 0
        const scopes = []
        while(true) {
          let num = 0
          while(checkPrefix('^'))
            num++
          if(num) {
            if(checkPrefix('@'))
              scopes.push(['scope', -1-num])
            else
              scopes.push(['scope', -1-num])
          } else if(checkPrefix('!')) {
            if(scopes.length == 0) {
              push('dup')
              stackScopes++
            }
          } else if(!checkPrefixes([['@', ['scope', -1]], ['$', ['tmps']], ['#', false]], item => {
            scopes.push(item)
            if(item == false) {
              stackScopes++
              if(subjects.at(-1) == args.length -1) {
                subjects.pop()
                push(...args.pop())
              }
            }
          }))
            break
        }
        let name = getName()
        let subject = 0
        if(name != null || forcedName) {
          subject = -1
          if(name != '_' && name != null) {
            if(mark)
              mark.push(name)
            push('const', name)
          }
          args.push(false)
          if(!scopes.length)            
            scopes.push(['scope', -1])
        } else if(subjects.length) {
          subject = subjects.pop() - args.length
        } else if(argCount >= 0) {
          if(arity < 0)
            subject = -argCount+arity
          else {
            if(argCount >= 0)
              argCount += scopes.length
            args.push(...scopes.splice(0))
            stackScopes = 0
            if(args.at(-1)?.[0] == 'const')
              subject = -1
            else
              subject = -Math.max(argCount+1, arity)
          }
        }

        for(let p = args.length; p --> 0;) {
          let pos = p - args.length + 1
          if(operator || pos - (name ? 1 : 0) < subject)
            pos -= stackScopes
          pos ||= null
          if(args[p] == 'seed') {
            if(seed)
              throw 'double seed'
            wordEnds.push(makeSeed(orphan, pos))
          } else if(args[p])
            push(...args[p], pos)
        }
        let scopeCount = 0
        for(let c = 0; c < scopes.length; c++) {
          const scope = scopes[c]
          if(name && operator == 'assign' && c < scopes.length -1) {
            if(scope)
              push(...scope, -1)
            push(c ? 'assign' : 'access')
            push('const', name)
            continue
          } else if(scope)
            push(...scope, (subject + c -scopes.length +1) || null)
          scopeCount++
        }
        if((name != null || forcedName) && operator)
          push(operator)
        return [scopeCount, argCount, subject, arity]
      }
      const decHusk = name => husks.at(-1)[name].pop()
      const escapeStr = str => str.replaceAll('\\"', '"').replace('\\n', '\n')
      let token = str.slice(start, end)
      if(checkPrefix('"')) {
        for(c = start; c < str.length; c++)
          if(str[c] == '"' && str[c-1] != '\\')
            break
        if(c == str.length)
          throw 'unclosed "'
        push('const', escapeStr(str.slice(start, c)))
      } else if(checkSuffix('"')) {
        push('const', escapeStr(str.slice(start, end)))
      } else if(token in constants)
        push('const', constants[token])
      else if(token in actions)
        actions[token]()
      else {
        const autoDiscard = cmd => _=> {
          push(cmd)
          if(discard)
            push('discard')
        }
        const doom = cmd => {
          cmd.doomed = true
          return cmd
        }
        const opNames = [
          ['++', 'inc'], ['+-', 'splice'], ['--', 'dec'], ['-+', 'splice'],
          ['>>', 'shr'], ['<<', 'shl'], ['**', 'pow'], ['*/', 'invPow'],
          ['>|', 'max'], ['<|', 'min'], ['==', 'equal'], ['!=', 'notEq'],
          ['>=', 'greaterEq'], ['<=', 'lessEq'], ['+@', 'inherit'],
          ['!$', 'toFunc'], ['#$', 'toNumber'], ['+$', 'join'],
          ['-/', 'floorDiv'], ['+/', 'ceilDiv'], ['*-', 'neg'], ['-*', 'neg'],
          ['>', 'greater'], ['<', 'less'], ['+', 'add'], ['-', 'sub'],
          ['*', 'multiply'], ['/', 'divide'], ['%', 'mod'], ['&', 'and'],
          ['|', 'or'], ['~', 'not'], ['^', 'xor'], ['$', 'toString'],
        ]

        const dots = [['.', 1], [':', 2], ['?', 3]]
        function deconstruct(arity = 0, access = true) {
          push('clearStage')
          const spellStart = spell.length
          const commas = [[',', 1], [';', 2], ['!', 3]]
          let argCount = 0
          const process = (func, def) => {
            let mod = 0
            while(true) {
              if(checkPrefixes(dots, num => {
                func(true, num)
                if(num == 1) mod--
              }));
              else if(checkPrefixes(commas, num => func(false, num)));
              else if(checkPrefix('&'))
                push('pushAllArg')
              else if(str[start].match(/[a-zA-Z_]/)) {
                let s = start
                for(; s < end-1; s++)
                  if(!str[s].match(/[a-zA-Z0-9_]/))
                    break
                if(str[s] == '"') {
                  push('const', str.slice(start, s))
                  push('pushArg', -1)
                  start = s+1
                } else break
              } else break
              mod++
            }
            if(!mod)
              def?.()
          }
          process((dot, num) => {
            push(dot ? 'pushArg' : 'copyArg', -num)
            argCount++
          })
          let scope = 0
          while(checkPrefixes([
            ['#', _=>{
              process((dot, num) => push(dot ? 'pushObj' : 'copyObj', -num), _=>push('pushObj', -1))
            }],
            ['@', _=>{
              let excluded = []
              const traverse = num => {
                for(let i = 0; i < excluded.length; i++)
                  if(excluded[i] > num)
                    return [i, num]
                  else
                    num++
                return [excluded.length, num]
              }
              process((dot, num) => {
                const [i, pos] = traverse(num)
                push('scope', -pos)
                push('pushObj', -1)
                if(dot)
                  excluded.splice(i, 0, pos)
              }, _=>{
                if(!excluded.length)
                  scope--
                push('scope', traverse(-1)[1])
                push('pushObj', -1)
              })
            }],
            ['^', _=>{
              let mod = 0
              let pos = 0
              process((dot, num) => {
                pos += num
              }, _=> pos++)
              push('scope', -pos-!mod)
              push('pushObj')
            }],
          ], item=>item())) {
            if(checkPrefix('*')) {
              push('dupObj')
              scope++
            }
            scope++
          }
          console.log(scope)
          if(start < end) {
            console.log('aa', scope, start, end)
            if(!scope) {
              push('scope', -1)
              push('pushObj', -1)
              scope++
            }
            argCount++
            //for(let i = arity-1; i --> argCount;)
            //  push('pushArg', -1)
            push('const', getName())
            push('pushArg', -1)
            if(access)
              push('stageAccess')
          } else {
            if(!access && !scope) {
              push('scope', -1)
              push('pushObj', -1)
            }
          }
          push('reverseArg')
          for(let i = arity-argCount; i --> 0;)
            push('pushArg', -1-i)
        }
        function pushCall(results = []) {
          if(results.length) {
            while(true)
              if(checkSuffixes(dots, num => results.splice(0,0, -num)));
              else
                break
            let opName
            if(checkSuffixes(opNames, item => opName = item)) {
              const mid = checkSuffix('/')
              deconstruct(!unaryOps.includes(opName) + 1 + mid)
              push(opName, null, null, null, false, results)
              return
            }
          }
          checkSuffix('!')
          const disjoined = checkSuffix('{')
          const doomed = checkSuffix('~')
          deconstruct()
          if(disjoined) {
            let cmd
            if(checkHusk('spindle', item => {
              item[0]('access', '}')
              cmd = push('disjoin')
              push('prev')
              push(item[1], 0, 2, -2)
            }))
              cmd = push('disjoin')
            branches.push(true)
            branchEnds.push([cmd])
          }
          push('call', results, doomed, checkSuffix('.') ? 1 : checkSuffix('][') ? 'reverse' : null)
        }
        function makeSeed(orphan, pos) {
          seed = push('seed', orphan, pos)
          const tmps = incHusk('pull')
          push('prev')
          tmps('assign', '>')
          checkHusk('spindle', item => {
            push('prev')
            item[0]('access', '}')
            push(item[1], 0, 2, -1)
          })
          return orphan ? _=> {
            tmps('access', '>')
            push('addRestore')
            push('return')
            containers.at(-1).push(_=>addLabel(seed))
            addLabel(seed)
          } : _=>{
            tmps('access', '>')
            push('addRestore')
            const goto = push('goto')
            containers.push([_=> {
              addLabel(goto)
              addLabel(seed)
            }])
            addLabel(seed)
          }
        }
        const makePull = _=> {
          const tmps = incHusk('pull')
          tmps('assign', '_')
          tmps('assign', '@')
          tmps('access', '@')
          tmps('access', '_')
          push('access')
          containers.push([_=>{
            tmps('access', '@')
            tmps('access', '_')
            push('assign')
            decHusk('pull')
          }])
        }
        function makeLoop(pop, number, array, map, upward, extra = true) {
          const container = array || map
          const iterate = number || container
          upward &&= iterate
          const boundCount = upward ? 1 : 0
          const tmps = incHusk('loops')
          if(container) {
            if(map) {
              if(!pop)
                push('scope')
              push('dup')
              tmps('assign', '(@)')
              push('getKeys')
            } else if(!pop)
              push('stack')
            push('dup')
            tmps('assign', '(:)')
            push('const', 'length')
            push('access')
          }
          if(iterate) {
            if(upward) {
              tmps('assign', '(#)')
              push('const', 0)
              tmps('assign', '()')
              addLabel(loopStarts)
              tmps('access', '(#)')
              tmps('access', '()')
            } else {
              tmps('assign', '()')
              addLabel(loopStarts)
              tmps('access', '()')
              push('dup')
              push('dec')
              tmps('assign', '()')
              push('const', 0)
            }
            push('lessEq')
            pushSave(loopEnds.at(-1), 'goif')
            if(container) {
              if(map) {
                tmps('access', '(@)')
                tmps('access', '(:)')
                tmps('access', '()')
                push('access')
              } else {
                tmps('access', '(:)')
                tmps('access', '()')
              }
              if(extra) {
                push('dup')
                push('setExtra')
              }
              push('access')
            } else
              tmps('access', '()')
          } else {
            addLabel(loopStarts)
          }
          loopStack.push(pos => {
            if(upward) {
              tmps('access', '()')
              push('inc')
              tmps('assign', '()')
            }
            push('goto', pos)
            addLabels(loopEnds)
            decHusk('loops')
          })
        }
        if(checkPrefixes([
          ['<-', _=> {
            let count = -1
            let cmd
            if(checkPrefix('?'))
              cmd = 'goif'
            else if(checkSuffix('-'))
              cmd = 'goto'
            while(checkSuffix('-')) count--
            cmd.push(loopStarts.at(count))
          }],
          [']', _=> {
            // Container close
            if(!containers.length)
              throw 'over-close []'
            let container = containers.pop()
            discard = checkPrefix('x')
            container.forEach(func => func())
          }],
        ], item => item()));
        else if(checkSuffixes([
          ['\\', _=> detectAccess('access')],
          [':##', _=> {
            push('debugStack', Number(getRest()))
          }],
          ['!##', _=> {
            push('logCmds', checkSuffix(':'))
          }],
          ['()', _=> {
            push('mark', getName())
          }],
          ['[', _=> {
            // Container open
            if(str[end-1]?.match?.(/\w/)) {
              if(checkPrefix('\\')) {
                const name = getName()
                const container = [_=> {
                  const labels = []
                  const start = husks.at(-1).start
                  for(let i = spell.length; i --> start;)
                    if(spell[i][0] == cmdIndex('label'))
                      labels.push(spell[i][1])
                  snippets[name] = {start, end:spell.length, labels}
                  for(const cmd of husks.pop().ends)
                    addLabel(cmd)
                }]
                containers.push(container)
                husks.push({ends:[], containers:container, start:spell.length})
              } else {
                const pos = spell.length
                deconstruct(2, false)
                push('assign')
                const ending = spell.splice(pos)
                const cmd = ['backhusk']
                addLabel(cmd)
                const container = [_=> {
                  for(const cmd of husks.pop().ends)
                    addLabel(cmd)
                  push(...cmd)
                  push('dup')
                  if(terminate) {
                    for(let i = containers.length; containers[--i] != container;) {
                      containers[i].forEach(func => {
                        if(func.doomed)
                          func()
                      })
                    }
                  }
                  spell.push(...ending)
                }]
                containers.push(container)
                husks.push({ends:[], containers:container, backhusk:true})
              }
            } else if(checkSuffix('&')) {
              push('andSpindle')
              const tmps = incHusk('spindle', 'and')
              tmps('assign', '}')
              containers.push([_=>{
                tmps('access', '}')
                decHusk('spindle')
              }])
            } else if(checkSuffix('~@')) {
              push('newPacts')
              push('newScope')
              push('pushScope')
              containers.push([doom(_=>push('popPacts')), doom(_=>{push('popScope'); push('discard')})])
            } else if(checkSuffix('~')) {
              push('newPacts')
              containers.push([doom(_=>push('popPacts'))])
            } else {
              let popCount = 0
              while(checkPrefix('.'))
                popCount++
              if(checkSuffix('@')) {
                if(popCount == 0)
                  push('newScope')
                push('pushScope')
                containers.push([doom(autoDiscard('popScope'))])
              } else if(checkSuffix(':')) {
                push('pushStack', popCount)
                containers.push([doom(_=>{
                  if(terminate)
                    push('popStack')
                  else {
                    push('popStack')
                    if(discard)
                      push('discard')
                  }
                })])
              } else if(popCount) {
                const c = [_=>{hungValCount.pop()}]
                const usage = popCount
                hungValCount.push(usage)
                for(; popCount --> 0;) {
                  const tmps = incHusk('hung', usage)
                  tmps('assign', '.')
                  c.push(doom(_=> {
                    if(!discard)
                      decHusk('hung')[0]('access', '.')
                  }))
                }
                if(checkSuffix('!'))
                  for(let i = 0; i < usage; i++)
                    husks.at(-1).hung.at(-i-1)[0]('access', '.')
                containers.push(c)
              } else {
                // Husk
                const cmd = push('husk')
                const container = [
                  _=> {
                    for(const cmd of husks.pop().ends)
                      addLabel(cmd)
                    addLabel(cmd)
                  }
                ]
                if(checkSuffix('/')) {
                  container.push(_=>push('slice'))
                  push('preslice')
                  if(checkSuffix('*'))
                    container.push(_=>push('fuse'))
                }
                containers.push(container)
                husks.push({ends:[], containers:container})
              }
            }
          }],
          ['}', _=> {
            // Branch close
            const hasEnding = checkSuffix(',')
            const branch = branches.pop()
            if(branch !== false) {
              if(hasEnding || branch?.keep)
                pushSave(branchEnds.at(-1), 'goto')
              const ending = branch?.[';;']?.() || false
              if(hasEnding)
                push('const', ending)
              if(branch?.keep)
                push('discard')
              addLabels(branchEnds)
            } else {
              addLabels(loopEnds)
            }
          }],
          ['+:', _=> {
            detectAccess('access', false)
            loopEnds.push([])
            makeLoop(true, false, true, false, true, false)
            loopStack.pop()(loopStarts.pop())
          }],
          ['-:', _=> {
            const s = start, e = end
            let arg = getRest()
            if(isNaN(arg)) {
              start = s
              end = e
              push('clearStack')
              push('extra')
              detectAccess('assign', true)
            } else {
              arg = Number(arg)
              if(arg < 0)
                for(arg = -arg; arg-->0;)
                  push('discard')
              else
                push('clearStack', arg)
            }
          }],
          ['->', _=> {
            let count = -1
            let cmd = 'goto'
            if(checkPrefix('?'))
              cmd = 'goif'
            while(checkPrefix('-')) count--
            pushSave(loopEnds.at(count), cmd)
          }],
          ...opNames.map(([op, opName]) =>[op, _=> {
            let opType = ''
            const mid = checkSuffix('/')
            const clone = checkSuffix('!')
            const transform = clone || checkSuffix('?')
            const [containers, args, subject, arity] = detectAccess('access', false, !unaryOps.includes(opName) + 1 + mid)
            push(opName, args, arity, subject, clone)
            if(transform)
              push('prev')
          }]),
          ['=', _=> {
            const token = str.slice(start, end)
            const transform = checkSuffix('?')
            if(checkSuffixes(opNames, item => opName = item)) {
              const mid = checkSuffix('/')
              const [_, args, subject, arity] = detectAccess(null, true, !unaryOps.includes(opName) + 1 + mid)
              makePull()
              push(opName, args, arity, subject)
              containers.pop().forEach(func => func())
            } else {
              deconstruct(2, false)
              push('assign')
            }
            if(transform)
              push('prev')
          }],
          [',', _=> {
            discard = !checkPrefix('!')
            if(start == end) {
              branches.at(-1)[',']()
            } else {
              const len = branches.length
              const type = str[end-1]
              if(type in singleBranches) {
                Object.assign(branches[len-1], singleBranches[type])
              } else if(type in multiBranches) {
                const instance = branches[len-1]
                Object.assign(instance, multiBranches[type])
              } else {
                branches[len-1][','](getName())
                return
              }
              end--
              branches.at(-1)[','](getName())
            }
          }],
          ['{', _=> {
            // Branch open
            if(start == end) {
              loopEnds.push([])
              branches.push(false)
            } else if(checkSuffix('>')) {
              branches.push({';;':makeSeed(true, null)})
              branchEnds.push([])
            } else if(checkSuffix('[')) {
              branches.push({';;':makeSeed(false, null)})
              branchEnds.push([])
            } else {
              branchEnds.push([])
              const keep = checkPrefix(',')
              if(keep)
                push('dup')
              checkPrefixes([['-', 'notEq'], ['>', 'greater'], ['<', 'less']], item => {
                const cmd = spell.at(-2)
                const simpleCmds = {
                  [cmdIndex('const')]:_=>{
                    spell.push(...spell.splice(-2, 1))
                  },
                  [cmdIndex('access')]:_=>{ // code not generialized for all simple access commands
                    const s3 = spell.at(-3)
                    const s4 = spell.at(-4)
                    if(s3[0] != cmdIndex('scope') || s3[2] != -1 || s4[0] != cmdIndex('const'))
                      throw 'probably not simple access'
                    spell.push(...spell.splice(-4, 3))
                  },
                }
                if(keep) {
                  if(!(cmd[0] in simpleCmds))
                    throw 'not simple command'
                  simpleCmds[cmd[0]]()
                }
                push(item)
              })
              const type = getRest()
              if(type in singleBranches) {
                branches.push({branches:[], single:true, keep, ...singleBranches[type]})
              } else if(type in multiBranches) {
                const branch = multiBranches[type]
                const cmd = branch.push()
                branches.push({...multiBranch,
                  ',':branch[','],
                  ';':branch[';'],
                  cmd, keep,
                })
                if(branch.label)
                  return
              } else throw 'invalid branch type: ' + type
              branches.at(-1)[',']?.()
            }
          }],
          ['(', _=> {
            // Loop
            loopEnds.push([])
            const number = checkSuffix('#')
            const array = checkSuffix(':')
            const map = checkSuffix('@')
            if(checkPrefix(':'))
              push('prev')
            makeLoop(true, number, array, map, checkSuffix('+'))
          }],
          ['=>.', _=> {
            pushCall()
            spell.at(-1)[0] = cmdIndex('postpone')
          }],
          ['!', _=> pushCall()],
          ['.', _=> pushCall([-1])],
          [':', _=> pushCall([-2])],
          ['?', _=> pushCall([-3])],
        ], item => item()));
        else if(!isNaN(str.slice(start, end))) {
          const num = Number(getRest())
          push('const', num)
        } else if(checkPrefix('-')) {
          push('const', getName())
          push('scope', -1, null)
          push('dec')
        } else if(checkPrefix('+')) {
          push('const', true)
          push('scope', -1, null)
          push('const', getName())
          push('assign')
        } else if(checkPrefix('\\')) {
          const labelMap = {}
          const snippet = snippets[getName()]
          for(const label of snippet.labels)
            labelMap[label] = labelCount++
          for(let i = snippet.start; i < snippet.end; i++) {
            const cmd = [...spell[i]]
            if(cmd[0] === cmdIndex('label'))
              cmd[1] = labelMap[cmd[1]]
            else
              for(let a = cmd.length; a --> 1;)
                if(cmd[a]?.[0] === cmdIndex('label'))
                  cmd[a] = [cmdIndex('label'), labelMap[cmd[a][1]]]
            spell.push(cmd)
          }
        } else
          detectAccess('access', false)
        if(start < end)
          throw 'token ' + str.slice(wordStart, c) + ' has unprocessed parts: ' + str.slice(start, end)
        while(wordEnds.length)
          wordEnds.shift()()
      }
      wordStart = c+1
    }
    for(const cmd of husks.pop().ends)
      addLabel(cmd)
    push('popPacts')
    discard = true
    containers.pop().forEach(func => func())
    if(containers.length)
      throw 'unclosed containers'
    return {code:spell, start:0, end:connect(spell)}
  }
  function connect(spell) {
    const labels = []
    let offset = 0
    for(let s = 0; s < spell.length; s++) {
      if(spell[s][0] == cmdIndex('label')) {
        labels[spell.splice(s,1)[0][1]] = s-- - offset
      } else if(spell[s][0] == cmdIndex('mark')) {
        spell.splice(s,1)
      } else if(spell[s][0] == cmdIndex('preslice')) {
        while(spell[++s+2][0] != cmdIndex('slice'));
        offset++
      }
    }
    for(let s = 0; s < spell.length; s++) {
      const cmd = spell[s]
      if(cmd[0] == cmdIndex('preslice')) {
        spell.splice(s,1)
        while(spell[s++][0] != cmdIndex('slice'));
      } else {
        for(let a = cmd.length; a --> 1;) {
          if(cmd[a]?.[0] === cmdIndex('label'))
            cmd[a] = labels[cmd[a][1]] - s -1
        }
      }
    }
    return spell.length
  }

  function contains(obj, name) {
    if(name in obj)
      return true
    for(obj of obj.scopes || [])
      if(contains(obj, name))
        return obj
    return false
  }
  const options = {
    customAccess: _=>{}
  }
  const elements = [
    ['label', null],
    ['preslice', null],
    ['mark', null],
    ['clearStage', (flow, vsl) => {
      flow.stage.arg = []
      flow.stage.obj = []
    }],
    ['pushArg', (flow, vsl, pos) => {
      flow.stage.arg.push(flow.splice(pos, 1)[0])
    }],
    ['reverseArg', (flow, vsl, pos) => {
      flow.stage.arg = flow.stage.arg.reverse()
    }],
    ['pushAllArg', (flow, vsl) => {
      flow.stage.arg.push(...flow.splice(0).reverse())
    }],
    ['copyArg', (flow, vsl, pos) => {
      flow.stage.arg.push(flow.stack.slice(pos, pos+1 || Infinity)[0])
    }],
    ['dupObj', (flow, vsl, pos) => {
      flow.stage.obj.push(flow.stage.obj.at(-1))
    }],
    ['pushObj', (flow, vsl, pos) => {
      flow.stage.obj.push(flow.splice(pos, 1)[0])
    }],
    ['copyObj', (flow, vsl, pos) => {
      flow.stage.obj.push(flow.stack.slice(pos, pos+1 || Infinity)[0])
    }],
    ['logCmds', (flow, vsl, logStack) => {
      vsl.logger.logCmds = true
      vsl.logger.logStack = logStack
    }],
    ['debugStack', (flow, vsl, count) => {
      vsl.log(JSON.stringify(flow.stack.slice(flow.stack.length-count)))
    }],
    ['seed', (flow, vsl, orphan, pos, start, end) => {
      start += flow.start
      end += flow.start
      let newVsl
      vsl.makeFlow([...flow.scopes], orphan ? flow.resultCount : 0, [], {code:flow.code, start, end}, orphan ? flow.pact : makePact(), a => newVsl = a)
      newVsl.timeTravel = true
      if(orphan)
        newVsl.pact = flow.pact
      else {
        newVsl.pact = makePact()
        flow.pact.dooms.push(newVsl.pact)
      }
      vsl.prev = newVsl
      flow.insert(newVsl, pos)
      if(orphan)
        newVsl.flows = vsl.flows.splice(vsl.flowBarriers.pop())
    }],
    ['clone', (flow, vsl) => {
      const subject = flow.pop()
      flow.push(
        typeof subject == 'function' ? {func:subject, scopes:[]} :
        Array.isArray(subject) ? [...subject] :
        typeof subject == 'object' ? {...subject} :
        subject
      )
    }],
    ['husk', (flow, vsl, end) => {
      const realEnd = flow.start + end
      const husk = {code:flow.code, start:flow.start, end:realEnd}
      flow.push(husk)
      flow.start = realEnd
    }],
    ['backhusk', (flow, vsl, start) => {
      const realStart = flow.start + start
      const husk = {code:flow.code, start:realStart, end:flow.start}
      flow.push(husk)
    }],
    ['bind', (flow, vsl) => flow.peek().scopes = [...flow.scopes]],
    ['fuse', (flow, vsl) => {
      const spell = flow.peek().code
      const scopes = flow.scopes
      for(let s = spell.length; s --> 0;)
        if(spell[s][0] == cmdIndex('scope') && spell[s][1] >= -scopes.length && spell[s][1] < scopes.length)
          spell[s] = [cmdIndex('const'), scopes.at(spell[s][1]), spell[s][2]]
    }],
    ['slice', (flow, vsl) => {
      const h = flow.peek()
      h.code = h.code.slice(h.start, h.end)
      h.end -= h.start
      h.start = 0
      h.sliced = true
    }],
    ['destructor', (flow, vsl, end) => {
      const h = flow.pop()
      flow.peek()['~'] = h
    }],
    ['terminate', (flow, vsl) => {
      vsl.popFlow([], true)
    }],
    ['clearStack', (flow, vsl, num) => vsl.extra = flow.splice(0, flow.stack.length - num)],
    ['goto', (flow, vsl, pos) => {
      flow.start += pos
    }],
    ['goif', (flow, vsl, pos) => {
      if(flow.pop()) (flow.start += pos)
    }],
    ['goifnot', (flow, vsl, pos) => {
      if(!flow.pop()) (flow.start += pos)
    }],
    ['access', (flow, vsl) => {
      const name = flow.pop()
      let obj = flow.pop()
      const custom = options.customAccess(obj, name)
      if(custom)
        flow.stack.push(...custom)
      else if(obj[name] !== undefined)
        flow.push(obj[name])
      else {
        for(obj of obj.scopes || [])
          if(contains(obj, name)) {
            flow.push(obj[name])
            return
          }
        flow.throw('not in scope', {name, obj})
      }
    }],
    ['stageAccess', (flow, vsl) => {
      const name = flow.stage.arg.pop()
      let obj = flow.stage.obj.pop()
      console.log(name, obj)
      if(obj[name] !== undefined)
        flow.stage.arg.push(obj[name])
      else {
        for(obj of obj.scopes || [])
          if(contains(obj, name)) {
            flow.stage.arg.push(obj[name])
            return
          }
        flow.throw('not in scope', {name, obj})
      }
    }],
    ['assign', (flow, vsl) => {
      const name = flow.stage.arg.shift()
      flow.stage.obj.pop()[name] = flow.stage.arg.pop()
    }],
    ['const', (flow, vsl, val, pos) => flow.insert(val, pos)],
    ['scope', (flow, vsl, num, pos) => {
      if(flow.scopes.at(num) == null)
        flow.throw('no scope at: ' + num)
      flow.insert(flow.scopes.at(num), pos)
    }],
    ['stack', (flow, vsl) => flow.push(flow.stack)],
    ['disjoin', (flow, vsl, end) => {
      vsl.pushFlow([], null, {...flow, scopes:[...flow.scopes], end:flow.start += end}, 0, true)
      vsl.prev = vsl.flow
    }],
    ['call', (flow, vsl, results, doomed, arity) => {
      let func = flow.stage.arg.shift()
      const scopes = flow.stage.obj.reverse()
      const args = flow.stage.arg
      flow.debugDetail('func', {func, scopes})
      if(typeof func == 'string')
        func = scopes.at(-1)[func]
      if(func == null)
        flow.throw('nullfunc', flow.debugDetails.func)
      if(func.timeTravel)
        vsl.flowBarriers.push(vsl.flows.length+1)
      if(arity == 1) {
        for(let i = args.length; i-->0;)
          vsl.pushFlow(scopes, [args[i]], func, results)
      } else if(arity == 'reverse') {
        vsl.pushFlow(scopes, [], func, results)
        vsl.pushFlow([], [], {...vsl.flow, stack:args, ...func['~'], resultCount:null}, null)
      } else
        vsl.pushFlow(scopes, args, func, results)
      if(doomed) {
        if(!func['~'])
          throw 'null destructor'
        flow.pact.dooms.push([[], {...vsl.flow, ...func['~'], resultCount:0}])
      }
    }],
    ['postpone', (flow,vsl, scopeCount, argCount, results, subjectPos) => {
      //pullArgs2(flow, argCount, scopeCount+1, subjectPos)
      let func = flow.stage.obj.shift()
      const scopes = flow.stage.obj.reverse()
      const args = flow.stage.arg
      makeFlow(null, null, args, {...func}, func.pact, a => vsl.flows.splice(vsl.flowBarriers.at(-1), 0, a))
      
    }],
    ['return', (flow, vsl) => {
      const stack = flow.stack.slice(flow.stackBarriers.at(-1))
      let arr = []
      if(flow.resultCount == null)
        arr = stack
      else {
        const r = []
        for(const pos of flow.resultCount)
          r.push(flow.stack.at(pos))
        arr = r.reverse()
      }
      vsl.popFlow(arr)
    }],
    ['getKeys', (flow, vsl) => flow.push(Object.keys(flow.pop()))],
    ['dup', (flow, vsl) => flow.push(flow.peek())],
    ['discard', (flow, vsl) => flow.pop()],
    ['multigoto', (flow, vsl, other, ...gotos) => {
      const pos = gotos[flow.pop()]
      flow.start += pos ?? other
    }],
    ['switch', (flow, vsl, other, ...cases) => {
      const val = flow.pop()
      for(let i = 0; i < cases.length; i+=2) {
        if(cases[i] == val) {
          flow.start += cases[i+1]
          return
        }
      }
      flow.start += other
    }],
    ['setExtra', (flow, vsl) => vsl.extra = flow.pop()],
    ['setPrev', (flow, vsl) => vsl.prev = flow.pop()],
    ['newPacts', (flow, vsl) => {
      flow.pact.barriers.push(flow.pact.dooms.length)
    }],
    ['popPacts', (flow, vsl) => {
      for(let i = flow.pact.barriers.at(-1); i < flow.pact.dooms.length; i++) {
        const doom = flow.pact.dooms[i]
        if(doom.dooms)
          flow.pact.dooms.push(...doom.dooms.splice(0))
        else
          vsl.pushFlow([], ...doom)
      }
      flow.pact.dooms.splice(flow.pact.barriers.at(-1))
      while(flow.pact.restores.length && flow.pact.restores.at(-1)[0] > flow.pact.barriers.at(-1))
        flow.pact.restores.pop()
      flow.pact.barriers.pop()
    }],
    ['addRestore', (flow, vsl)=> {
      const newVsl = flow.pop()
      newVsl.pact.restores.push([newVsl.pact.dooms.length, newVsl.start])
    }],
    ['pushScope', (flow, vsl) => {
      flow.scopes.push(flow.pop())
    }],
    ['popScope', (flow, vsl) => {
      flow.push(flow.scopes.pop())
    }],
    ['pushStack', (flow, vsl, depth) => {
      flow.stackBarriers.push(flow.stack.length - depth)
    }],
    ['popStack', (flow, vsl) => {
      flow.push(flow.stack.splice(flow.stackBarriers.pop()))
    }],
    ['inherit', (flow, vsl, argCount, _arity, subjectPos, clone) => {
      let [subject, objects, args] = pullArgs(flow, argCount, 2, subjectPos, clone)
      vsl.prev = subject
      if(!subject.scopes)
        subject.scopes = []
      for(const arg of [...args, ...objects])
        subject.scopes.push(arg)
    }],
    ...[
      ['prev', vsl => vsl.prev],
      ['extra', vsl => vsl.extra],
      ['tmps', vsl => vsl.flow.temporaries],
      ['newScope', _=> ({})],
      ['newStack', _=> []],
      ['andSpindle', vsl => ({'&':0, '}':[],
        dec:function() {
          if(!--this['&']) {
            for(const event of this['}']) {
              const newVsl = Vessel(event, [], vsl.logger)
              while(!newVsl.run());
            }
          }
        },
      })],
      ['orSpindle', vsl => ({'|':0, '}':[]})],
    ].map(item => {
      const gen = item[1]
      return [item[0], (flow, vsl, pos) => flow.insert(gen(vsl), pos)]
    }),
  ]
  const baseOps = {
    add:(a,b)=>a+b, sub:(a,b)=>a-b, multiply:(a,b)=>a*b, divide:(a,b)=>a/b,
    mod:(a,b)=>a%b, and:(a,b)=>a&b, or:(a,b)=>a|b, xor:(a,b)=>a^b,
    shr:(a,b)=>a>>b, shl:(a,b)=>a<<b, sqrt:(a,b)=>Math.sqrt(a,b),
    max:(a,b)=>Math.max(a,b), min:(a,b)=>Math.min(a,b),
    lessEq:(a,b)=>a<=b, equal:(a,b)=>a==b, less:(a,b)=>a<b,
    greater:(a,b)=>a>b, greaterEq:(a,b)=>a>=b, notEq:(a,b)=>a!=b,
    pow:(a,b)=>Math.pow(a,b),invPow:(a,b)=>Math.pow(a,1/b),
  }
  const defaultOps = {
    floorDiv: (_, subject, objects) => Math.floor(subject/objects[0]),
    ceilDiv: (_, subject, objects) => Math.ceil(subject/objects[0]),
    inc: (_,subject) => subject+1,
    dec: (_,subject) => subject-1,
    not: (_,subject) => !subject,
    neg: (_,subject) => -subject,
  }
  const unaryOps = ['toString', 'toFunc', 'inc', 'dec', 'not', 'toNumber', 'join']
  for(const op in baseOps) {
    const operator = baseOps[op]
    defaultOps[op] = (vsl, subject, objects, args) => {
      for(const arg of [...args, ...objects])
        subject = baseOps[op](subject, arg)
      return subject
    }
  }
  const cmdIndex = cmd => {
    if(typeof cmd == 'number')
      return cmd
    const result = elements.findIndex(item => item[0] == cmd)
    if(result == -1)
      throw 'unknown command: ' + cmd
    return result
  }
  const spindleOps = {
    and:(vsl, subject, objects, args) => {
      args.push(objects[0])
      for(const flow of args) {
        subject['&']++
        if(!flow.flows)
          flow.flows = []
        flow.flows.push({func:_=> {
          subject.dec()
        }})
      }
    },
    add:(vsl, subject, objects, args) => {
      args.push(objects[0])
      for(const vsl of args)
        subject['}'].push(vsl)
    },
  }
  const huskOps = {
    join:(vsl,subject) => {
      if(!subject.sliced)
        vsl.flow.throw('modifying unsliced husk')
      subject.end = connect(subject.code)
    },
    multiply:(vsl, subject, objects, args) => {
      if(!subject.scopes)
        subject.scopes = []
      subject.scopes.push(...args, ...objects)
    },
    add:(vsl, subject, objects, args) => {
      if(!subject.sliced)
        vsl.flow.throw('modifying unsliced husk')
      args.push(objects[0])
      const spell = subject.code
      let pos
      if(objects[1]) {
        pos = spell.findIndex(item => item[0] == cmdIndex('mark') && item[1] == objects[1])
        spell.splice(pos, 1)
        if(pos == -1)
          throw 'mark not found'
      } else pos = spell.length
      for(let husk of args) {
        if(!husk.code)
          husk = {code:[[cmdIndex('const'), husk]], start:0, end:1}
        spell.splice(pos, 0, ...husk.code.slice(husk.start, husk.end))
        pos += husk.end - husk.start
      }
    }
  }
  const arrayOps = {
    and:(vsl, subject, objects) => {
      return subject.indexOf(objects[0]) +1
    },
    dec:(vsl, subject, objects) => {
      vsl.extra = [subject.splice(objects[0] ?? -1, 1)[0]]
    },
    add:(vsl, subject, objects, args) => {
      args.push(objects[0])
      subject.splice(objects[1] ?? subject.length, 0, ...args)
    },
    inc:(vsl, subject, objects, args) => {
      subject.splice(objects[0] ?? subject.length, 0, ...args)
    },
    sub:(vsl, subject, objects, args) => {
      vsl.extra = [subject.splice(objects[0], objects.length > 1 ? objects[1] - objects[0] : subject.length, ...args)]
    },
    multiply:(vsl, subject, objects) => {
      const len = subject.length
      for(let i = objects[0]; i --> 0;)
        for(let j = 0; j < len; j++)
          subject.push(subject[j])
    },
    divide:(vsl, subject, objects) => {
      return subject.slice(objects[0], objects[1] ?? subject.length)
    },
  }
  const mapOps = { // return value is significant
    add:(vsl, subject, objects, args) => {
      for(const arg of [...args, ...objects])
        for(const name in arg)
          subject[name] = arg[name]
    },
    inc:(vsl, subject) => {subject[vsl.flow.pop()] = true},
    dec:(vsl, subject) => {delete subject[vsl.flow.pop()]},
  }
  const strOps = {
    add:(vsl, subject, objects, args) => {
      args.push(objects[0])
      let index = objects[1] ?? subject.length
      if(index < 0) {
        index += subject.length
        if(index < 0)
          index = 0
      }
      return subject.slice(0, index) + args.join('') + subject.slice(index)
    },
    dec: (vsl, subject) => {
      vsl.extra = [subject.at(-1)]
      return subject.slice(0,-1)
    },
    multiply: (vsl, subject, objects) => {
      let result = ''
      for(let i = objects[0]; i --> 0;)
        result += subject
      return result
    },
    divide: (vsl, subject, objects) => {
      return subject.slice(objects[0], objects[1] ?? subject.length)
    },
  }
  const operators = {
    toString: (vsl, subject) => JSON.stringify(subject),
    contain:(vsl, subject, objects) => {
      if(objects[0] in subject) {
        vsl.prev = subject[objects[0]]
        return true
      }
      return false
    },
    toNumber: (vsl, subject) => {
      if(!isNaN(subject))
        vsl.flow.push(Number(subject))
      return !isNaN(subject)
    },
    toFunc: (vsl, subject) => {
      return (...args) => {
        const newVsl = Vessel(subject, args, vsl.logger)
        while(!newVsl.run());
        return newVsl.results
      }
    },
  }
  for(const op of [...Object.keys(defaultOps), 'join']) {
    operators[op] = (vsl, subject, objects, args) => {
      if(subject == null)
        vsl.flow.throw('null subject')
      let operator
      let clone = a => a
      if(typeof subject == 'object') {
        vsl.prev = subject
        const base = contains(subject, '_' + op)
        clone = a => ({...a})
        if(Array.isArray(subject)) {
          operator = arrayOps[op]
          clone = a => [...a]
        } else if(base) {
          vsl.pushFlow([subject], [...args, ...objects], base['_' + op], 1)
          return
        } else if(subject['}']) {
          operator = spindleOps[op]
        } else if(subject.code) {
          operator = huskOps[op]
        } else if(Array.isArray(subject)) {
          operator = arrayOps[op]
        } else
          operator = mapOps[op]
      } else if(op in strOps && typeof subject == 'string') {
        operator = strOps[op]
      } else
        operator = defaultOps[op]
      if(operator == null)
        vsl.flow.throw("can't find operator for: " + op + ' of ' + subject)
      return operator(vsl, subject, objects, args)
    }    
  }
  const pullArgs = (flow, args, arity, subjectPos, clone) => pullArgsBase(flow, subjectPos, -arity, args, clone)
  //const pullArgs2 = (flow, args, arity, sub, clone) => {
  //  flow.stage.sub = flow.splice(sub, 1)[0]
  //  if(clone)
  //    subject = typeof subject == 'function' ? {func:subject, scopes:[]} :
  //      subject.code ? {...subject, code:[...subject.code], '/':{...subject['/']}} :
  //      Array.isArray(subject) ? [...subject] :
  //      typeof subject == 'object' ? {...subject} :
  //      subject
  //  const len = flow.stack.length
  //  flow.stage.obj = flow.splice(sub-arity+2, arity-1)
  //  flow.stage.arg = flow.splice(args < 0 ? 0 : len - args)
  //}
  const pullArgsBase = (flow, sub, arity, args, clone) => {
    let subject = flow.splice(sub, 1)[0]
    if(clone)
      subject = typeof subject == 'function' ? {func:subject, scopes:[]} :
        subject.code ? {...subject, code:[...subject.code], '/':{...subject['/']}} :
        Array.isArray(subject) ? [...subject] :
        typeof subject == 'object' ? {...subject} :
        subject
    const len = flow.stack.length
    return [subject, arity < 0 ? flow.splice(flow.stack.length +arity+1) : flow.splice(sub-arity+2, arity-1), flow.splice(args < 0 ? 0 : len - args)]
  }
  for(const op in operators) {
    const defaultArity = !unaryOps.includes(op) + 1
    elements.push([op, (flow, vsl, argCount = 0, arity = defaultArity, subjectPos = -defaultArity, clone = false, results) => {
      const result = Array.isArray(results) ? operators[op](vsl, flow.stage.arg.pop(), flow.stage.obj.reverse(), flow.stage.arg.reverse()) : operators[op](vsl, ...pullArgs(flow, argCount, arity, subjectPos, clone))
      if(result !== undefined)
        flow.push(result)
      if(results?.length)
        flow.push(vsl.extra.pop())
    }])
  }
  function unleash(func, scopes, logger = null) {
    if(logger == null)
      logger = _=>{}
    if(typeof func == 'string')
      func = consume(func)
    const vsl = Vessel({scopes, ...func, resultCount:null}, [], logger)
    while(!vsl.run());
    return vsl.results
  }
  const flatten = (spell, lineCount=false, sep='\n') => (spell.code || spell)
    .map(([cmd, ...args], index) => (lineCount ? index + ':' : '') + (elements[cmd]?.[0] ?? cmd) + ' ' + args.join(' ')).join(sep)
  function selfCheck() {
    let total = 0, pass = 0
    let output
    const scope = {
      print: (...args) => output += args.join('; ') + '; ',
    }
    const compr = (code, expect) => {
      output = ''
      console.log(code)
      const map = {}
      const spell = consume(code, map)
      console.log('>>', flatten(spell, true))
      if(unleash(spell, [scope], map) == null) {
        console.log('>>', flatten(spell, true))
        console.log()
      } else if(output != expect) {
        console.log('>>', flatten(spell, true))
        console.log()
        console.log('ACTUAL:  ', output)
        console.log('EXPECTED:', expect)
        console.log()
        throw 1
      } else
        pass++
      total++
    }
    compr('print "hello world" ..!', 'hello world; ')
    compr('"hello world" .print!', 'hello world; ')
    compr('" " .print!', ' ; ')
    compr('"hello \\"world\\"" .print!', 'hello "world"; ')
    compr('"hello" "world" + .print!', 'helloworld; ')
    compr('hello"world" .print!', 'hello"world; ')
    compr('61626364\' .print!', 'abcd; ')
    compr('"a" 3 = a .print!', '3; ')
    compr('a" ]" ["..+ .print!', '[a]; ')
    compr('"6" 3 * .print!', '666; ')
    compr('1 1 + .print!', '2; ')
    compr('23 5 % .print!', '3; ')
    compr('2 1 - .print!', '1; ')
    compr('3 1 << .print!', '6; ')
    compr('3 1 2 ,..- .print!', '0; ')
    compr('2 3 < .print!', 'true; ')
    compr('1 3 & .print!', '1; ')
    compr('1 3 | .print!', '3; ')
    compr('3 2** .print!', '8; ')
    compr('3 2 ** .print!', '9; ')
    compr('9 2 */ .print!', '3; ')
    compr('9 2 -/ .print!', '4; ')
    compr('true &{ "branch" .print! } "unbranch" .print! ', 'branch; unbranch; ')
    compr('true &{ false , "branch" .print! ; "else" .print! }', 'else; ')
    compr('true &{ true , "branch" .print! ; "else" .print! }', 'branch; ')
    compr('false |{ false , false , "branch" .print! ; "else" .print! }', 'else; ')
    compr('true |{ false , false , "branch" .print! ; "else" .print! }', 'branch; ')
    compr('false |{ true , false , "branch" .print! ; "else" .print! }', 'branch; ')
    compr('false |{ false , true , "branch" .print! ; "else" .print! }', 'branch; ')
    compr('100 &{ 200 ,} .print!', '200; ')
    compr('0 &{ 200 ,} .print!', 'false; ')
    compr('100 |{ 200 ,} .print!', 'true; ')
    compr('0 |{ 200 ,} .print!', '200; ')
    compr('1 2 ,-|{ t" &print! } &print!', '; ')
    compr('2 2 ,-|{ t" &print! } &print!', '2; t; ; ')
    compr('2 2 -|{ t" &print! } &print!', 't; ; ')
    compr('true &{ false ,} |{ true &{ true ,} , "branch" .print! ; "else" .print! }', 'branch; ')
    compr('true &{ false ,} |{ false &{ true ,} , "branch" .print! ; "else" .print! }', 'else; ')
    compr('true |{ false ,} &{ true |{ true ,} , "branch" .print! ; "else" .print! }', 'branch; ')
    compr('true |{ false ,} &{ false |{ false ,} , "branch" .print! ; "else" .print! }', 'else; ')
    compr('true &{ "b1" .print! ; "b2" .print! } "unbranch" .print! ', 'b1; unbranch; ')
    compr('false &{ "b1" .print! ; "b2" .print! } "unbranch" .print! ', 'b2; unbranch; ')
    compr('false &{ "b1" .print! ; "b2" .print! true , "b3" .print! ; "b4" .print! } "unbranch" .print! ', 'b2; b3; unbranch; ')
    compr('false &{ "b1" .print! ; "b2" .print! false |, "b3" .print! ; "b4" .print! } "unbranch" .print! ', 'b2; b3; unbranch; ')
    compr('false &{ "b1" .print! ; "b2" .print! false , "b3" .print! ; "b4" .print! } "unbranch" .print! ', 'b2; b4; unbranch; ')
    compr('false &{ "branch" .print! } "unbranch" .print! ', 'unbranch; ')
    compr('0 #{ "zero" ; "one" ;; "other" } "unb" ..print!', 'zero; unb; ')
    compr('1 #{ "zero" ; "one" ;; "other" } "unb" ..print!', 'one; unb; ')
    compr('10 #{ "zero" ; "one" ;; "other" } "unb" ..print!', 'other; unb; ')
    compr('2 1 "add" .{ add, + ; "sub" , - ; multiply, * } .print!', '3; ')
    compr('2 1 "sub" .{ add, + ; sub, - ; multiply, * } .print!', '1; ')
    compr('2 1 "multiply" .{ add, + ; sub, - ; multiply, * } .print!', '2; ')
    compr('2 2 "other" .{ add, + ; sub, - ; multiply, * } .print!', '2; ')
    compr('2 2 "other" ,.{ add, + ; sub, - ; multiply, * ;; .print! } .print!', 'other; 2; ')
    scope.obj = {a:1}
    compr('obj "a" #_ .print!', '1; ')
    compr('obj #a .print!', '1; ')
    compr('2 obj #a= obj #a .print!', '2; ')
    compr('1 obj #a+ ,b= .print!', '3; ')
    compr('b .print!', '3; ')
    compr(':[ 0 1 2 3 ] ,b= --. .print! b .print!', '3; 0,1,2; ')
    compr('[ + 2 ** ] a= 1 2 ..a. .print! 2 3 ..a. .print! [ - 2 ** ] a= 2 3 ..a. .print!', '9; 25; 1; ')
    compr('a[ hi"print! ]x @a!', 'hi; hi; ')
    compr('false [ &{ 10 ; 20 } ] :.!. .print!', '20; ')
    compr('true [ &{ 10 ; 20 } ] :.!. .print!', '10; ')
    compr('2 3 ,b= "a" ;= .print!', '3; ')
    compr('obj 2#a= 2 3 ,b= obj "a" !.#= .print! obj #a .print!', '3; 3; ')
    compr('obj 2#a= 2 3 ,b= obj ;#a= .print! obj #a .print!', '3; 3; ')
    compr('2 obj ;#a= .print!', '2; ')
    compr('2 obj "a" !#= .print!', '2; ')
    compr('"a" 9 obj #= obj #a .print!', '9; ')
    compr('[ a++= ] obj #inca= 0 obj #a= obj #*inca! obj #*inca!. obj #a .print!', '2; ')
    compr('5 #( .print! )', '4; 3; 2; 1; 0; ')
    compr('5 +#( .print! )', '0; 1; 2; 3; 4; ')
    compr(':[ 0 1 2 3 4 5 ] a= 0 a :( + ) .print!', '15; ')
    compr(':[ 0 1 2 3 4 5 ] a= 0 ::( + ) .print!', '15; ')
    compr('3 a= 1 a-= a .print!', '2; ')
    compr(':[ 0 1 2 ] a= 3 ;?+ .print!', '0,1,2,3; ')
    compr('@[ 1 a= @[ 2 a= 3 ^@a= ] b= ] c= c #a c #b #a ..print!', '3; 2; ')
    compr('@[ 1 a= ] $ .print!', '{"a":1}; ')
    compr('@[ 1 a= ] @[ 2 b= ] @[ 3 c= ] &+ :$ .print!', '{"a":1,"b":2,"c":3}; ')
    compr('1 2 3 4 &+ .print!', '10; ')
    compr('4 2 1 &- .print!', '1; ')
    compr(':[ 0 1 2 3 ] a= a-- %:print!', '3; 0,1,2; ')
    compr('[]a= a 0 1 2 3 &+ :print!', '0,1,2,3; ')
    compr('1 2 3 [] &,+ :print!', '1,2,3; ')
    compr('1 2 3 [] &,+ :print!', '1,2,3; ')
    compr('[] 1 2 3 &+ :print!', '1,2,3; ')
    compr('"lol" 1 a/+ :print!', '0,lol,1,2,3; ')
    compr('1 a/-- :%print!', '0,1,2,3; lol; ')
    compr('2 a/ 3 a/ ..print!', '2,3; 3; ')
    compr('2 3 a## -2 -1 a## ..print!', '2; 2; ')
    compr(':[ 0 1 2 3 4 ] a= -2 a- %:print!', '3,4; 0,1,2; ')
    compr(':[ 0 1 2 3 4 ] a= 2 4 a/- %:print!', '2,3; 0,1,4; ')
    compr(':[ 0 1 2 3 4 ] a= 2 4 &a/- %:print!', '2,3; 0,1,4; ')
    compr(':[ 0 1 2 3 4 ] a= "hello" "world" 2 4 &a/- %:print!', '2,3; 0,1,hello,world,4; ')
    compr('1 10 >| 20 10 >| &print!', '10; 20; ')
    compr('1 10 <| 20 10 <| &print!', '1; 10; ')
    compr('1 10 < 20 10 > &print!', 'true; true; ')
    compr('@[ 1a= 2$a= $a ^print: ] #a .print!', '2; 1; ')
    compr('3 #( $tmp= :[ $tmp ] ) &print!', '2; 1; 0; ')
    compr('@[ 1 a= ] obj= @[ 2 a= 3 b= ] obj2= [ a ^^print: b ^^print: ] a= obj obj2 a @##.', '2; 3; ')
    compr('@[ 1 a= ] obj= @[ 2 a= 3 b= ] obj2= [ a ^^print: b ^^print: ] a= a obj obj2 @##* :a= a.', '2; 3; ')
    compr('1 $a= null a= $@a= a .print!', '1; ')
    compr('@[ 1 a= 2 b= ] @( .print! %print! )', '2; b; 1; a; ')
    compr(':[ 10 20 ] @( .print! %print! )', '20; 1; 10; 0; ')
    compr('"a" 0_= a .print!', '0; ')
    compr('"a" []_= a #length .print!', '0; ')
    compr('@[ 10no= +yes -no ] a= a $ &print!', '{"yes":true}; ')
    compr('5i= ( i--= :0> &{ -> } :print! )', '4; 3; 2; 1; 0; ')
    compr(':[ 12 34 56 ] a= 34 a& 23 a& &print!', '2; 0; ')
    compr('[] 1 .+ :print!', '1; ')
    compr('@[ 12base= ] b= b @[ 34child= ] ?+@ a=  a #child a #base ..print! b 56#base= a #base .print!', '34; 12; 56; ')
    scope.Date = {
      raw:_=>new Date().toISOString().slice(-1),
    }
    compr('@[ 10b= [ ^print: b ^print: ] a= ] !#a 20 .@#!', '20; 10; ')
    compr('Date .@[ @[ [ #value !#startsWith value .#! ] _and= ] _proto= [ @[ value= ] _proto ?+@ ] new= [ raw! new: ] now= ]', '')
    compr('"2023" Date #new? "2023-12" Date #new? & .print!', 'true; ')
    compr('0 1 2 3 4 -: &print!', '; ')
    compr('0 1 2 3 4 2-: &print!', '3; 4; ')
    compr('0 1 2 3 4 -2-: &print!', '0; 1; 2; ')
    compr('true &{ "yea" .print! => } "nay" .print!', 'yea; ')
    compr('[ &{ "yea" => } "nay" ] true ? .print! ', 'yea; ')
    compr('[ .:[ &{ "yea" => } 0 1 ] ] true ? .print! ', 'yea; ')
    compr('[ .:[ &{ "yea" => } 0 1 ] ] false ? .print! ', '0,1; ')
    compr('100a= @[ 99a= ] @[ 88a= ] [ ^a ] ##! .print!', '99; ')
    compr('0b= [ b++= ] @* :a= a. @[ 0b= ^@a. ] #b b ..print!', '0; 2; ')
    compr('0b= [ b++= ] a= a. @[ 0b= ^@a @. ] #b b ..print!', '1; 1; ')
    compr('9a= ## 1a=\na .print!', '9; ')
    compr(':[ 0 1 2 ] a= &a++ a .print! 99 1 &a/++ a .print!', '0,1,2; 0,99,1,2; ')
    compr('/[ true ] 0a= [ &{ "t" .print! ; "f" .print! } ] + ;+$ ;@.', 't; ')
    compr('/[ false ] 0a= [ &{ "t" .print! ; "f" .print! } ] + ;+$ ;@.', 'f; ')
    compr('[] 1 2 3 ...[]+ ;$ .print!', '[1,2,3,[]]; ')
    compr('[] 1 2 3 ...{}+ ;$ .print!', '[1,2,3]; ')
    compr('0 !&{ 2 % ; false } .print!', 'false; ')
    compr('14 !&{ 2 % ; false } .print!', '0; ')
    compr('11 !&{ 2 % ; false } .print!', '1; ')
    compr('11 10 !-&{ .print! ; "ten" .print! }', '11; ')
    compr('10 10 !-&{ .print! ; "ten" .print! }', 'ten; ')
    compr('"a" "." !-&{ .print! ; "dot" .print! }', 'a; ')
    compr('"." "." !-&{ .print! ; "dot" .print! }', 'dot; ')
    compr('10 0 !>&{ .print! ; "neg" .print! }', '10; ')
    compr('-3 -1 !>&{ .print! ; "neg" .print! }', 'neg; ')
    compr('1 2 3 4 -: %a= &print!', '; ')
    compr('a+: &print!', '1; 2; 3; 4; ')
    compr('13 .[ # .print! ] .print!', '13; 13; ')
    compr('13 14 ..[ # &print! ] &print!', '13; 14; 13; 14; ')
    compr('13 14 ..![ &print! ] &print!', '13; 14; 13; 14; ')
    compr('13 14 ..[ ]x &print!', '; ')
    compr('3a?= b= a b &print!', '3; 3; ')
    compr('0`my number`= `my number` .print!', '0; ')
    compr('[ 23 + ] !$ add=', '')
    scope.a = scope.add(3)
    compr('a .print!', '26; ')
    compr('/[ @[ ()name= ()age= &{ ()gender= } ] ] a= ;!+$ a_= false 10 "joe" &a_! $ .print!', '{"name":"joe","age":10}; ')
    compr('13b= */[ b ] "age" a/+ ;+$ :c= false "joe" &c! $ 14b= false "jack" ..c! $ false "jack" ..a! $ &print:', '{"name":"joe","age":13}; {"name":"jack","age":14}; {"name":"jack","age":14}; ')
    compr('/[ @[ name= age() age= &{ gender= } ] ] a= 13b= */[ b ] "age" a!/+ +$ :c= a!+$ a_= false 10 "joe" &a_! $ .print!', '{"name":"joe","age":10}; ')
    compr('false "joe" &c! $ .print!', '{"name":"joe","age":13}; ')
    compr('/[ @[ ()name= ()age= &{ ()gender= } ] ] 69 "age" /+ ;+$ ;a= false "joe" &a! $ .print!', '{"name":"joe","age":69}; ')
    compr('[]log= "events" log+ [onClick= "clicked" log+ ] [onPress= $key= "pressed " $key + log+ ] "registered" .print! log .print! "enter" onPress: log .print! onClick. log .print! "enter" onPress: log .print!', 'registered; events; events,pressed enter; events,pressed enter,clicked; events,pressed enter,clicked,pressed enter; ')
    compr('[]pool= [ @[ name= ] !pool+ ][ pool& !&{ -- pool/-- } ] makeObj= "quan" makeObj~? pool& .print!', '1; ')
    compr('pool #length .print!', '0; ')
    compr('~[ "meow" makeObj~: ~[ "meowmeow" makeObj~: pool #length .print! ] pool #length .print! ] pool #length .print!', '2; 1; 0; ')
    compr('[] log= [onClick= "click" log+ >onPress= "both" log+ ] onClick. log .print! "enter" onPress: log .print!', 'click; click,both; ')
    compr('0usage= [ usage++= ][ usage--= ] Use= ~@[ [onClick= ^Use~. >onPress= ^Use~. ]x onClick. ^usage ^print: onClick. ^usage ^print: onPress. ^usage ^print: ] usage .print!', '1; 1; 2; 0; ')
    compr('0usage= [onClick= ~[ Use~. >onPress= Use~. ] ] onClick. usage .print! onClick. usage .print! onPress. usage .print!', '1; 1; 0; ')
    compr('0usage= [ ~@[ &[ [^onClick= ^Use~. ] [^onPress= ^Use~. ] ] >+ ^Use~. >^onConfirm= ] ] @{. } onClick. usage .print! onPress. usage .print! onConfirm. usage .print!', '1; 3; 0; ')
    compr('0usage= [ [ 1print: >onClick= 2print: ] @. 3print: ] @{. 4print: } 5print: onClick.', '1; 5; 2; 3; 4; ')
    compr('[ [ 1print: >{ onClick= } 2print: ] @. 3print: ] @{. 4print: } 5print: onClick.', '1; 5; 2; 3; 4; ')
    compr('[ &[ [ .print! >onClick= ] a" @{: clicked" .print! } [ >onPress= ] @{. pressed" .print! } ] >+ both" .print! ] @{. } onPress. onClick.', 'a; pressed; clicked; both; ')
    compr('@[ 1a= 3c= ] obj= :#a .print!', '1; ')
    compr('obj a" &#{ ; none" } .print!', '1; ')
    compr('obj b" &#{ ; none" } .print!', 'none; ')
    compr(']" [" ..print!', ']; [; ')
    compr('\'a= [ a+= ] append= Ab"C"De"append.. a .print!', 'AbCDe; ')
    compr('[ &print! ] a= 1 0.a.', '0; 1; ')
    compr('[]log= [ log+ 5 ][ -* log+ 9 ] func= 3func. 4func][! log &print!', '5; 3,-4,9; ')
    console.log(pass, '/', total)
  }
  function noScope(func) {
    for(const cmd of func.code)
      if(cmd[0] == cmdIndex('scope'))
        return false
    return true
  }
  function extendElements(name, func) {}
  selfCheck()
  return {consume, flatten, elements, unleash, noScope, options}
})()
