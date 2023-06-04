const chaos = require('./compiler')
const fs = require('fs')
const logFile = fs.openSync('log.txt', 'w')

chaos.options.customAccess = (obj, name) => {
  if(obj == library && name[0].match(/[A-Z]/)) {
    const parseAddress = str => {
      str = str.toUpperCase()
      let col = 0
      let i = 0
      for(; i < str.length; i++) {
        const code = str.charCodeAt(i)
        if(code >= 65 && code < 91)
          col = col*26 + code-65
        else break
      }
      let row
      if(str[i] == '$')
        row = Number(str.slice(i+1))
      else
        row = library.row - Number(str.slice(i))
      return [row, col]
    }
    const index = name.indexOf(':')+1
    if(index) {
      const [row1, col1] = parseAddress(name.slice(0, index-1))
      const [row2, col2] = parseAddress(name.slice(index))
      const arr = []
      for(let r = row1; r <= row2; r++)
        arr.push(...library.table[r].slice(col1, col2+1))
      return arr
    } else {
      const [row, col] = parseAddress(name)
      return [library.table[row][col]]
    }
  }
}
function consume(str) {
  const table = []
  let row = []
  table.push(row)
  let c = 0
  let cellStart = 0
  let cellEnd = 0
  // Main
  for(; c <= str.length; c++) {
    let newline = false
    if(str[c] == '\n') {
      if(str[c-1] == ';') {
        newline = true
      } else {
        let cont = false
        for(let i = cellStart; i < c; i++)
          if(str[i] != ' ')
            cont = true
        if(cont) continue
        if(row.length)
          table.push(row = [])
        if(cellStart == c)
          cellStart++
        cellEnd = c+1
      }
    } else if(c < str.length && str[c] != ' ') continue
    if(c == cellStart || str[c-1] != ';') {
      cellEnd = c+1
      continue
    }
    let end = c-1
    let start = cellEnd
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
    const notEmpty = !!str.slice(cellStart, cellEnd).match(/[^\s]/)
    const getCell = _=> str.slice(cellStart, cellEnd-notEmpty).replace('\\ ', ' ')
    if(checkSuffixes([
      ['"', _=> row.push(getCell())],
      ['!', _=> {
        const func = chaos.consume(getCell())
        if(chaos.noScope(func))
          row.push(chaos.unleash(func, [])[0])
        else
          row.push(func)
      }],
      ['()', _=> {
        const func = chaos.consume(getCell())
        func.loop = true
        row.push(func)
      }],
      ['^', _=> {
        row.push(table.at(-2)[row.length])
      }],
      ['@', _=> {
        row.push({default:true, clear:checkSuffix('-')})
      }],
      ['[]', _=> {
        const func = chaos.consume(getCell())
        func.template = true
        func.id = getName()
        row.push(func)
      }],
    ], a=>a()));
    else {
      if(start == end) {
        if(cellStart == cellEnd)
          row.push(null)
        else {
          const val = getCell()
          if(isNaN(val))
            row.push({value:val})
          else
            row.push(Number(val))
        }
        start = end
      }
    }
    if(start != end) throw 'unprocessed part: ' + str.slice(start, end)
    cellEnd = cellStart = c+1
    if(newline)
      table.push(row = [])
  }
  if(!table.at(-1).length)
    table.pop()
  return {
    str,
    src:table,
    calc:function() {
      this.table = []
      let newRow
      this.row = 0
      let srcRow = 0
      this.default = []
      for(; srcRow < this.src.length; this.row++, srcRow++) {
        const row = this.src[srcRow]
        const last = row.at(-1)
        if(last?.loop) {
          if(chaos.unleash(row[0], [this])[0])
            srcRow-=2
          this.row--
        } else if(last?.default) {
          if(last.clear)
            this.default = []
          for(let i = 0; i < row.length-1; i++) {
            if(row[i] != null) {
              if(row[i].value == '-')
                this.default[i] = undefined
              else
                this.default[i] = row[i]
            }
          }
          this.row--
        } else if(last?.template) {
          this.table.push({template:row.slice(0, -1), id:last.id})
        } else {
          this.table.push(newRow = [])
          const max = Math.max(row.length, this.default.length)
          for(let c = 0; c < max; c++) {
            let cell = row[c]
            if(cell == null)
              cell = this.default[c]
            if(cell?.code)
              newRow.push(chaos.unleash(cell, [this])[0])
            else
              newRow.push(cell)
          }
        }
      }
      return this.table
    },
    stringify:arr => {
      let str = ''
      for(const cell of arr) {
        if(typeof cell == 'number') {
          str += cell + ' ; '
        } else if(typeof cell == 'string') {
          str += cell.replaceAll('; ', ';\\ ') + (cell.match(/[^\s]/) ? ' "; ' : '"; ')
        } else if(cell == null)
          str += '; '
        else if(cell.code)
          throw 'cant stringify code'
        else if(cell.date)
          str += cell.date + ' /; '
      }
      return str.slice(0,-1)
    },
    useTemplate:function(tmpl) {
      const newRow = []
      for(let cell of tmpl.template) {
        if(cell.code)
          cell = chaos.unleash(cell, [this])[0]
        newRow.push(cell)
      }
      for(let i = 0; i < this.src.length; i++) {
        if(this.src[i].at(-1).id == tmpl.id) {
          this.src.splice(i,0, newRow)
          break
        }
      }
      let templatePos = this.str.indexOf(tmpl.id + '[]; ')
      if(templatePos == -1)
        templatePos = this.str.indexOf(tmpl.id + '[];\n')
      if(templatePos == -1)
        throw 'cant find template'
      const pos = this.str.slice(0, templatePos-1).lastIndexOf('\n')
      this.str = this.str.slice(0, pos) + '\n' + this.stringify(newRow) + this.str.slice(pos)
    },
    date:{
      now: function() {
        return {date:new Date().toLocaleString('sv')}
      },
      today: function() {
        return {date:this.now().date.slice(0,10)}
      },
    }
  }
}
function render(calc, {cellSize=10, cellSep=' ; '} = {}) {
  const cells = calc.map(row => {
    if(row.template)
      return ['[' + row.id + ']']
    return row.map(cell => {
      if(cell == null)
        return ' '.repeat(cellSize)
      let pad = 'end'
      if(cell.date)
        cell = cell.date
      if(typeof cell == 'string') {
        if(cell.length > cellSize)
          cell = cell.slice(0,cellSize-1) + '…'
      } else if(typeof cell == 'number') {
        pad = 'start'
        if(cell == 0) {
          cell = '0'
        } else {
          const trimNum = (num, cellSize) => { // bugs out when num >= 1e21, or num > 1e cellSize
            const result = num.toString().slice(0, cellSize)
            if(result.at(-1) == '.')
              return result.slice(0, -1)
            return result
          }
          const log10 = Math.log(10)
          let exp10 = Math.floor(Math.log(Math.abs(cell)) / log10) + 1
          if(exp10 > cellSize || exp10 < -4) {
            exp10 = Math.floor((exp10-1)/3) *3
            const min = 'e' + exp10
            if(min.length >= cellSize)
              cell = '#'.repeat(cellSize)
            else {
              cell = cell / Math.pow(10,exp10)
              cell = trimNum(cell, cellSize-min.length) + min
            }
          } else {
            cell = trimNum(cell, cellSize)
          }
        }
      }
      return pad == 'start' ? cell.padStart(cellSize) : cell.padEnd(cellSize)
    })
  })
  //for(const row of cells) {
  //  let line = ''
  //  for(const cell of row)
  //    line += cell + cellSep
  //  console.log(line.slice(0, -cellSep.length))
  //}
  chaos.unleash(`
    0x= 0y= 0selX= cells #length len= len stdout #rows rows= :<| -- selY= 0selDY=
    redraw[
      stdout .@[
        0 0cursorTo:
        clearScreenDown.
        rows -- +#( %\\ &{ A'write. } $r= ^cells ^y $r+ #_ !&{ '$line= .+:( %\\ &{ ^sep $line+= } $line+= ) $line ^x ^x columns+ .// write: } )
        // rows-- +#( ^y+ ^cells# ,&{ "" :+:%( &{ ^sep+ } + ) ^x ,columns+ // A' :.write,! } )
      ]
    ]
    recursor[
      selX step* x - y selY- stdout .#cursorTo:
    ]
    [ $func= stdin .@[ +setRawMode. "data" $func .on: ][ data" $func .removeListener: -setRawMode. ] ] goraw=
    // [ stdin .@[ +setRawMode! data" ,;on! ][ ..removeListener! -setRawMode! ] ] goraw=
    >{ !$ goraw~: }
    {
      .{
        03' , null -> ;
        0d' , value -> ;
        1b5b41' , selY 0 >&{ selY--= } ;
        1b5b42' , selY++= ;
        1b5b44' , selX 0 >&{ selX--= } ;
        1b5b43' , selX++= ;
        1B' , selDY rows <&{ y selY= rows selDY= ; 0selY= len selDY=  } ;;
        ~>
      }
      recursor.
      ~>
    }
  `, [{cells, stdin, stdout, sep:cellSep, step:cellSize+cellSep.length}], {
      func:str => {
        fs.writeSync(logFile, str)
      },
  })
}
const stdin = process.stdin
const stdout = process.stdout
const library = consume(`
amount "; time "; category "; type ";
; ; ; A0 0 > &{ deposit" ;\\ withdraw" } !; @;
1 ;
-3 ;
-33333333333333333333 ; ; ; ; ; ; ; ; ; ; ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
-3 ;
0 ; date #today! !; "; add[];
`)
render(library.calc())
