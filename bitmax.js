
const CryptoJS = require('crypto-js'); const fs = require('fs')
const axios = require('axios')

const bitmax = {}

const failureAuth = ['ApiKeyFailure']

const baseURL = 'https://bitmax.io/api/v1/'
let identity = {}
let apikey = ''
let secret = ''
let group = ''

const instance = axios.create({
  headers: {
    'User-Agent': 'node-bitmax-api'
  },
  timeout: 30000,
  baseURL
})
async function request (url, params = {}) {
  return new Promise((resolve, reject) => {
    instance.get(url, { params })
      .then(function (response) {
        resolve(response.data)
      })
      .catch(function (error) {
        if (error.response) console.warn(error.response.data)
        reject(error.message)
      })
  })
}
async function signedRequest (method = 'GET', endpoint, params = {}, coid = false) {
  let base = baseURL
  if (endpoint.startsWith('@')) {
    base = `https://bitmax.io/${group.accountGroup}/api/v1/`
    endpoint = endpoint.substr(1)
  }
  return new Promise((resolve, reject) => {
    let timestamp = new Date().getTime()
    let headers = { 'x-auth-key': apikey, 'x-auth-timestamp': timestamp }
    let apipath = endpoint
    let hashstr
    if (endpoint.indexOf('balance/') !== -1) {
      apipath = 'balance'
    } else if (endpoint.indexOf('order/') !== -1 && endpoint.length > 32) {
      apipath = 'order'
    }
    if (coid) {
      if (coid === true) {
        coid = getCoid()
      }
      params.coid = coid
      params.time = timestamp
      headers['x-auth-coid'] = coid
      hashstr = `${timestamp}+${apipath}+${coid}`
    } else {
      hashstr = `${timestamp}+${apipath}`
    }
    let hash = CryptoJS.HmacSHA256(hashstr, secret)
    let hashInBase64 = CryptoJS.enc.Base64.stringify(hash)
    headers['x-auth-signature'] = hashInBase64
    let authOptions = {
      method,
      url: base + endpoint,
      data: params,
      json: true,
      headers
    }
    return axios(authOptions).then(function (response) {
      resolve(response.data)
    })
  })
}

// Generate 32 bit order id generated from current time converted to base 64
function getCoid () {
  let seed = new Date().toLocaleString() + new Date().getTime(); let coid = Buffer.from(seed.substr(-32)).toString('base64').replace(/=/g, '').substr(-32)
  return coid
}

// List all assets
bitmax.assets = async (params = {}) => {
  return request('assets', params)
}

// 24h ticker
bitmax.prevDay = async (params = {}) => {
  return request('ticker/24hr', params)
}

// Fees
bitmax.fees = async (params = {}) => {
  return request('fees', params)
}

// Bar History Info
bitmax.barinfo = async (params = {}) => {
  return request('barhist/info', params)
}

// Candlestick Bar History
bitmax.candles = async (params = {}) => {
  if (typeof params.symbol === 'undefined') throw new Error("ERROR: parameter 'symbol' is required.")
  if (typeof params.from === 'undefined') params.from = new Date().getTime() - (17 * 60 * 60 * 24 * 1e3) // 17 days ago default
  if (typeof params.interval === 'undefined') params.interval = 360 // 6h default
  return request('barhist', params)
}

// Level 1 Order Book
bitmax.quote = async (params = {}) => {
  if (typeof params.symbol === 'undefined') throw new Error("ERROR: parameter 'symbol' is required.")
  return request('quote', params)
}

// Level 2 Order Book
bitmax.depth = async (params = {}) => {
  if (typeof params.symbol === 'undefined') throw new Error("ERROR: parameter 'symbol' is required.")
  if (typeof params.n === 'undefined') params.n = 10
  return request('depth', params)
}

// Trades
bitmax.trades = async (params = {}) => {
  if (typeof params.symbol === 'undefined') throw new Error("ERROR: parameter 'symbol' is required.")
  if (typeof params.n === 'undefined') params.n = 10
  return request('trades', params)
}

// User Info
async function userinfo (params = {}) {
  return signedRequest('GET', 'user/info', params)
}

// Balances
bitmax.balances = async (params = {}) => {
  return signedRequest('GET', '@balance', params)
}

// Balance of one asset
bitmax.balance = async (symbol, params = {}) => {
  return signedRequest('GET', `@balance/${symbol}`, params)
}

// Deposit/Withdraw History
bitmax.transaction = async (assetCode, type = 'deposit', params = {}) => {
  params.txType = type
  params.assetCode = assetCode
  return signedRequest('GET', `@transaction`, params)
}

// Place an order
bitmax.order = async (orderType = 'limit', side = 'buy', symbol, orderPrice, orderQty, params = {}) => {
  params.orderType = orderType
  params.side = side
  params.symbol = symbol
  params.orderPrice = String(orderPrice)
  params.orderQty = String(orderQty)
  if (typeof params.timeInForce === 'undefined') params.timeInForce = 'GTC'
  return signedRequest('POST', `@order`, params, true)
}

// Get Fills of One Order (api_path=order/fills)
// GET <account-group>/api/v1/order/fills/<coid>

// Get Basic Order Data of one order
bitmax.orderStatus = async (coid, params = {}) => {
  return signedRequest('GET', `@order/${coid}`, params)
}

// Cancel an order
bitmax.cancel = async (symbol, origCoid, params = {}) => {
  params.symbol = symbol
  params.origCoid = origCoid
  return signedRequest('DELETE', `@order`, params, true)
}

// Cancel all orders, symbol is optional
bitmax.cancelAll = async (symbol = false, params = {}) => {
  if (symbol) params.symbol = symbol
  return signedRequest('DELETE', `@order/all`, params)
}

// Batch cancel orders
bitmax.batchcancel = async (coids, params = {}) => {
  params.origCoid = coids.join('+')
  return signedRequest('DELETE', `@order/batch`, params, true)
}

/*
    POST <account-group>/api/v1/order/batch place multiple orders in one batch
    Add WebSocket functionality
    */

// Switch to a different account
bitmax.setAccount = alias => {
  if (typeof identity[alias] === 'undefined') {
    throw new Error(`setAccount(${alias}) ERROR: No alias by that name`)
  }
  ({ apikey, secret, group } = identity[alias])
}

bitmax.auth = async (_apikey, _secret = false, alias = false) => {
  return new Promise(async (resolve, reject) => {
    if (!_secret) { // Load from json
      let json = JSON.parse(fs.readFileSync(_apikey, 'utf8'))
      apikey = json.apikey
      secret = json.secret
      group = await userinfo()
      if (failureAuth.includes(group.message)) {
        return reject(group)
      }
      if (typeof json.alias !== 'undefined') {
        alias = json.alias
      }
      if (alias) {
        identity[alias] = { apikey, secret, group }
      }
      return resolve(true)
    }
    apikey = _apikey
    secret = _secret
    group = await userinfo()
    if (failureAuth.includes(group.message)) {
      return reject(group)
    }
    if (alias) {
      identity[alias] = { apikey, secret, group }
    }
    return resolve(true)
  })
}

module.exports = bitmax
