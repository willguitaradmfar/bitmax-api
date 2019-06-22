const a = require('../')

a.depth({ symbol: 'BTC/USDT' }).then(a => {
  console.log(a)
})
