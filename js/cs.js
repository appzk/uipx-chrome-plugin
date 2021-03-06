const clienW = document.documentElement.clientWidth || document.body.clientWidth
// 覆盖在页面上层进行对比的 canvas元素的 handle
let canvas = null

// 通信接口，接收其他模块发送来的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('cs.js _getMessage_', request, sender, sendResponse)
  sendResponse('done')
  const { name, data } = request
  // 处理对比图片 / 反相
  if (name === VARS.imgBase64Name || name === VARS.carpCheckName || name === VARS.sizeCheckName) {
    return invokeImg.init(data)
  }
  // 下面的情况都需要 canvas 已经初始化完毕才可以正常执行
  if (!canvas) {
    return console.log('必须初始化 canvas')
  }
  const rqMap = {
    [VARS.canvasPResetName] () {
      // canvas 滑动的位置恢复
      canvasPosition.reset()
      followCheckScroll.baseScroll = 0
    },
    [VARS.opacityChangeName] () {
      // canvas整体透明度调节
      updataCanvasOpacity(data)
    },
    [VARS.followCheckName] () {
      // canvas 跟随页面滚动对比
      followCheckScroll.change(data)
    },
    [VARS.staffGaugeName] () {
      // 标尺
      staffGauge.change(data)
    },
    [VARS.diffImgDelName] () {
      // 删除对比的UI图片
      diffImgDel()
    },
    [VARS.microActionName] () {
      // 位置微调
      microAction(data)
    }
  }
  const fn = rqMap[name]
  fn ? fn() : console.log('未处理的消息：', name, data)
})

// canvas 处理
const invokeImg = {
  container: document.body,
  bgData: null,
  pixels: null,
  init (bgData) {
    if (JSON.stringify(this.bgData) === JSON.stringify(bgData)) return
    this.bgData = bgData
    const ctx = this.getCtx()
    const img = document.createElement('img')
    img.src = bgData.base64
    img.onload = () => {
      const width = bgData.isUseUISize ? img.width : clienW
      const isSizeChanged = canvas.style.width.slice(0, -2) !== String(width)
      const scale = img.width / width
      const height = img.height / scale
      canvas.width = width
      canvas.height = height
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      const imgData = ctx.getImageData(0, 0, width, height)
      this.pixels = imgData.data
      // 透明
      this.setOpacity()
      // 反相
      this.setColorReverse()
      ctx.clearRect(0, 0, width, height)
      ctx.putImageData(imgData, 0, 0)
      this.container.appendChild(canvas)
      if (isSizeChanged) {
        // 位置恢复，切换 sizeCheckName 的时候元素可能完全跑到页面外去了，所以这里统一恢复一下位置
        canvasPosition.reset()
      }
    }
  },
  // 设置透明
  setOpacity () {
    const opacityColorList = this.bgData.opacityColorList
    if (opacityColorList && opacityColorList.length) {
      const pixels = this.pixels
      for (let i = 0; i < pixels.length; i += 4) {
        if (this.isOpacityFit(i)) {
          pixels[i + 3] = 0
        }
      }
    }
  },
  // 设置反相
  setColorReverse () {
    if (this.bgData.isColorReverse) {
      const pixels = this.pixels
      for (let i = 0; i < pixels.length; i += 4) {
        // 已经设定为透明的色值不要反相
        if (pixels[i + 3] !== 0) {
          pixels[i + 0] = 255 - pixels[i + 0]
          pixels[i + 1] = 255 - pixels[i + 1]
          pixels[i + 2] = 255 - pixels[i + 2]
        }
      }
    }
  },
  getCtx () {
    canvas = document.getElementById(VARS.diffCanvasId)
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.id = VARS.diffCanvasId
    }
    canvasTouch.init()
    return canvas.getContext('2d')
  },
  isOpacityFit (i) {
    return this.bgData.opacityColorList.some(item => {
      return this.pixels[i] === item[0] && this.pixels[i + 1] === item[1] && this.pixels[i + 2] === item[2]
    })
  }
}

// canvas 位置相关
const canvasPosition = {
  x: 0,
  y: 0,
  moveBy (x, y) {
    canvas.style.transform = `translate(${x === null ? this.x : (this.x + x)}px, ${y === null ? this.y : (this.y + y)}px)`
  },
  reset () {
    this.x = 0
    this.y = 0
    this.moveBy(0, 0)
  },
  correctXY () {
    const mt = canvas.style.transform.match(/translate\(([-+]?[\d\.]+)px,\s*([-+]?[\d\.]+)px\)/)
    if (!mt) return
    this.x = +mt[1]
    this.y = +mt[2]
  }
}

// canvas 的触摸滑动相关
const canvasTouch = {
  startX: 0,
  startY: 0,
  init () {
    canvas.addEventListener('touchstart', this.touchstartFn, { passive: false })
    canvas.addEventListener('touchmove', this.touchmoveFn, { passive: false })
    canvas.addEventListener('touchend', this.touchendFn, { passive: false })
  },
  destory () {
    canvas.removeEventListener('touchstart', this.touchstartFn)
    canvas.removeEventListener('touchmove', this.touchmoveFn)
    canvas.removeEventListener('touchend', this.touchendFn)
  },
  touchstartFn (e) {
    e.preventDefault()
    toggleLock.change(true)
    canvasTouch.startX = e.changedTouches[0].clientX
    canvasTouch.startY = e.changedTouches[0].clientY
  },
  touchmoveFn (e) {
    e.preventDefault()
    canvasPosition.moveBy(e.changedTouches[0].clientX - canvasTouch.startX, e.changedTouches[0].clientY - canvasTouch.startY)
  },
  touchendFn (e) {
    e.preventDefault()
    canvasPosition.correctXY()
    setTimeout(() => {
      toggleLock.change(false)
    }, 16)
  }
}

// canvas 跟随页面滚动相关
const followCheckScroll = {
  // 是否设置了 canvas 跟随页面滚动
  isFollowPage: false,
  baseScroll: 0,
  reset () {
    this.isFollowPage = false
    this.baseScroll = 0
  },
  change (v) {
    this.isFollowPage = v
    canvasPosition.correctXY()
    if (v) {
      this.baseScroll = window.scrollY
      canvasTouch.destory()
      window.addEventListener('scroll', this.canvasScrollByPage)
    } else {
      this.baseScroll = 0
      canvasTouch.init()
      window.removeEventListener('scroll', this.canvasScrollByPage)
    }
  },
  canvasScrollByPage () {
    canvasPosition.moveBy(null, -window.scrollY + followCheckScroll.baseScroll)
  }
}

// 禁止页面滚动的切换
const toggleLock = {
  originBodyOver: document.body.style.overflow,
  isLock: false,
  change (lock) {
    if (lock !== void 0) {
      this.isLock = lock
    } else {
      this.isLock = !this.isLock
    }
    document.body.style.overflow = this.isLock ? 'hidden' : this.originBodyOver
  }
}

// 标尺
const staffGauge = {
  rulerH: null,
  rulerV: null,
  change (isCheck) {
    if (!this.rulerH) {
      this.rulerH = new LinePositionManage()
      this.rulerH.init()
      this.rulerV = new LinePositionManage(false)
      this.rulerV.init()
    }
    this.rulerH.changeVisible(isCheck)
  }
}

// 删除对比的UI图片
function diffImgDel () {
  canvasPosition.reset()
  followCheckScroll.reset()
  invokeImg.container.removeChild(canvas)
  invokeImg.bgData = null
  canvas = null
}

// 位置微调
function microAction ({ x = 0, y = 0 }) {
  canvasPosition.moveBy(x, y)
  canvasPosition.correctXY()
}

// 调节 canvas整体的透明度
function updataCanvasOpacity (opacity) {
  canvas.style.opacity = opacity
}
