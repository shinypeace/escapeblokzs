function createCounter() {
    return {
        current: 0,
        next () {
            return ++this.current;
        }
    };
}
function createRequestResolver(instanceId) {
    const counter = createCounter();
    const promiseControllers = {};
    return {
        add (controller, customId) {
            const id = null != customId ? customId : `${counter.next()}_${instanceId}`;
            promiseControllers[id] = controller;
            return id;
        },
        resolve (requestId, data, isSuccess) {
            const requestPromise = promiseControllers[requestId];
            if (requestPromise) {
                if (isSuccess(data)) requestPromise.resolve(data);
                else requestPromise.reject(data);
                promiseControllers[requestId] = null;
            }
        }
    };
}
function promisifySend(sendEvent, subscribe, instanceId) {
    const requestResolver = createRequestResolver(instanceId);
    subscribe((event)=>{
        if (!event.detail?.data || 'object' != typeof event.detail.data) return;
        if ('request_id' in event.detail.data) {
            const { request_id: requestId, ...data } = event.detail.data;
            if (requestId) requestResolver.resolve(requestId, data, (data)=>!('error_type' in data));
        }
    });
    return function(method, props = {}) {
        return new Promise((resolve, reject)=>{
            const requestId = requestResolver.add({
                resolve,
                reject
            }, props.request_id);
            sendEvent(method, {
                ...props,
                request_id: requestId
            });
        });
    };
}
function createInstanceId() {
    const allNumbersAndLetters = 36;
    const positionAfterZeroAnDot = 2;
    const keyLength = 3;
    return Math.random().toString(allNumbersAndLetters).substring(positionAfterZeroAnDot, positionAfterZeroAnDot + keyLength);
}
const IS_CLIENT_SIDE = "u" > typeof window;
const IS_ANDROID_WEBVIEW = Boolean(IS_CLIENT_SIDE && window.AndroidBridge);
const IS_IOS_WEBVIEW = Boolean(IS_CLIENT_SIDE && window.webkit?.messageHandlers?.VKWebAppClose);
const IS_REACT_NATIVE_WEBVIEW = Boolean(IS_CLIENT_SIDE && window.ReactNativeWebView && 'function' == typeof window.ReactNativeWebView.postMessage);
const IS_WEB = IS_CLIENT_SIDE && !IS_ANDROID_WEBVIEW && !IS_IOS_WEBVIEW;
const IS_MVK = IS_WEB && /(^\?|&)vk_platform=mobile_web(&|$)/.test(location.search);
const IS_DESKTOP_VK = IS_WEB && !IS_MVK;
const EVENT_TYPE = IS_WEB ? 'message' : 'VKWebAppEvent';
const DESKTOP_METHODS = [
    'VKWebAppInit',
    'VKWebAppGetCommunityAuthToken',
    'VKWebAppAddToCommunity',
    'VKWebAppAddToHomeScreenInfo',
    'VKWebAppClose',
    'VKWebAppCopyText',
    'VKWebAppCreateHash',
    'VKWebAppGetUserInfo',
    'VKWebAppSetLocation',
    'VKWebAppSendToClient',
    'VKWebAppGetClientVersion',
    'VKWebAppGetPhoneNumber',
    'VKWebAppGetEmail',
    'VKWebAppGetGroupInfo',
    'VKWebAppGetGeodata',
    'VKWebAppGetCommunityToken',
    'VKWebAppGetConfig',
    'VKWebAppGetLaunchParams',
    'VKWebAppSetTitle',
    'VKWebAppGetAuthToken',
    'VKWebAppCallAPIMethod',
    'VKWebAppJoinGroup',
    'VKWebAppLeaveGroup',
    'VKWebAppAllowMessagesFromGroup',
    'VKWebAppDenyNotifications',
    'VKWebAppAllowNotifications',
    'VKWebAppOpenPayForm',
    'VKWebAppOpenApp',
    'VKWebAppShare',
    'VKWebAppShowWallPostBox',
    'VKWebAppScroll',
    'VKWebAppShowOrderBox',
    'VKWebAppShowLeaderBoardBox',
    'VKWebAppShowInviteBox',
    'VKWebAppShowRequestBox',
    'VKWebAppAddToFavorites',
    'VKWebAppShowStoryBox',
    'VKWebAppStorageGet',
    'VKWebAppStorageGetKeys',
    'VKWebAppStorageSet',
    'VKWebAppFlashGetInfo',
    'VKWebAppSubscribeStoryApp',
    'VKWebAppOpenWallPost',
    'VKWebAppCheckAllowedScopes',
    'VKWebAppCheckBannerAd',
    'VKWebAppHideBannerAd',
    'VKWebAppShowBannerAd',
    'VKWebAppCheckNativeAds',
    'VKWebAppShowNativeAds',
    'VKWebAppRetargetingPixel',
    'VKWebAppConversionHit',
    "VKWebAppShowSubscriptionBox",
    'VKWebAppCheckSurvey',
    'VKWebAppShowSurvey',
    'VKWebAppScrollTop',
    'VKWebAppScrollTopStart',
    'VKWebAppScrollTopStop',
    'VKWebAppShowSlidesSheet',
    'VKWebAppTranslate',
    'VKWebAppRecommend',
    'VKWebAppAddToProfile',
    'VKWebAppGetFriends',
    ...IS_DESKTOP_VK ? [
        'VKWebAppResizeWindow',
        'VKWebAppAddToMenu',
        'VKWebAppShowInstallPushBox',
        'VKWebAppShowCommunityWidgetPreviewBox',
        'VKWebAppCallStart',
        'VKWebAppCallJoin',
        'VKWebAppCallGetStatus'
    ] : [
        'VKWebAppShowImages'
    ]
];
let supportedHandlers;
const androidBridge = IS_CLIENT_SIDE ? window.AndroidBridge : void 0;
const iosBridge = IS_IOS_WEBVIEW ? window.webkit.messageHandlers : void 0;
const webBridge = IS_WEB ? parent : void 0;
function createVKBridge(version) {
    let webFrameId;
    const subscribers = [];
    const instanceId = createInstanceId();
    function send(method, props) {
        if (androidBridge?.[method]) androidBridge[method](JSON.stringify(props));
        else if (iosBridge?.[method] && 'function' == typeof iosBridge[method].postMessage) iosBridge[method].postMessage?.(props);
        else if (IS_REACT_NATIVE_WEBVIEW) window.ReactNativeWebView.postMessage(JSON.stringify({
            handler: method,
            params: props
        }));
        else if (webBridge && 'function' == typeof webBridge.postMessage) webBridge.postMessage({
            handler: method,
            params: props,
            type: 'vk-connect',
            webFrameId,
            connectVersion: version
        }, '*');
    }
    function subscribe(listener) {
        subscribers.push(listener);
    }
    function unsubscribe(listener) {
        const index = subscribers.indexOf(listener);
        if (index > -1) subscribers.splice(index, 1);
    }
    function supportsInner(method) {
        if (IS_ANDROID_WEBVIEW) return !!(androidBridge && 'function' == typeof androidBridge[method]);
        if (IS_IOS_WEBVIEW) return !!(iosBridge?.[method] && 'function' == typeof iosBridge[method].postMessage);
        if (IS_WEB) return DESKTOP_METHODS.includes(method);
        return false;
    }
    function supports(method) {
        console.warn('bridge.supports method is deprecated. Use bridge.supportsAsync instead.');
        return supportsInner(method);
    }
    function isWebView() {
        return IS_IOS_WEBVIEW || IS_ANDROID_WEBVIEW;
    }
    function isIframe() {
        return IS_WEB && window.parent !== window;
    }
    function isEmbedded() {
        return isWebView() || isIframe();
    }
    function isStandalone() {
        return !isEmbedded();
    }
    function handleEvent(event) {
        if (IS_IOS_WEBVIEW || IS_ANDROID_WEBVIEW) return [
            ...subscribers
        ].map((fn)=>fn.call(null, event));
        let bridgeEventData = event?.data;
        if (!IS_WEB || !bridgeEventData) return;
        if (IS_REACT_NATIVE_WEBVIEW && 'string' == typeof bridgeEventData) try {
            bridgeEventData = JSON.parse(bridgeEventData);
        } catch  {}
        const { type, data, frameId } = bridgeEventData;
        if (!type) return;
        if ('VKWebAppSettings' === type) {
            webFrameId = frameId;
            return;
        }
        [
            ...subscribers
        ].map((fn)=>fn({
                detail: {
                    type,
                    data
                }
            }));
    }
    if (IS_REACT_NATIVE_WEBVIEW && /(android)/i.test(navigator.userAgent)) document.addEventListener(EVENT_TYPE, handleEvent);
    else if ("u" > typeof window && 'addEventListener' in window) window.addEventListener(EVENT_TYPE, handleEvent);
    const sendPromise = promisifySend(send, subscribe, instanceId);
    async function supportsAsync(method) {
        if (IS_ANDROID_WEBVIEW || IS_IOS_WEBVIEW) return supportsInner(method);
        if (supportedHandlers) return supportedHandlers.has(method);
        try {
            const response = await sendPromise('SetSupportedHandlers');
            supportedHandlers = new Set(response.supportedHandlers);
        } catch (_error) {
            supportedHandlers = new Set([
                'VKWebAppInit'
            ]);
        }
        return supportedHandlers.has(method);
    }
    subscribe((event)=>{
        if (!event.detail) return;
        switch(event.detail.type){
            case 'SetSupportedHandlers':
                supportedHandlers = new Set(event.detail.data.supportedHandlers);
        }
    });
    return {
        send: sendPromise,
        sendPromise,
        subscribe,
        unsubscribe,
        supports,
        supportsAsync,
        isWebView,
        isIframe,
        isEmbedded,
        isStandalone
    };
}
var package_namespaceObject = {
    rE: "3.0.2"
};
function applyMiddleware(...middlewares) {
    if (middlewares.includes(void 0) || middlewares.includes(null)) return applyMiddleware(...middlewares.filter((item)=>'function' == typeof item));
    return (bridge)=>{
        if (0 === middlewares.length) return bridge;
        let send = ()=>{
            throw new Error("Sending events while constructing your middleware is not allowed. Other middleware would not be applied to this send.");
        };
        const middlewareAPI = {
            subscribe: bridge.subscribe,
            send: (...args)=>bridge.send(...args)
        };
        const chain = middlewares.filter((item)=>'function' == typeof item).map((middleware)=>middleware(middlewareAPI)).reduce((a, b)=>(send)=>a(b(send)));
        send = chain(bridge.send);
        return {
            ...bridge,
            send
        };
    };
}
const getLaunchParamsResponseLanguagesSet = new Set([
    'ru',
    'uk',
    'ua',
    'en',
    'be',
    'kz',
    'pt',
    'es'
]);
const getLaunchParamsResponseGroupRoleSet = new Set([
    'admin',
    'editor',
    'member',
    'moder',
    'none'
]);
const getLaunchParamsResponsePlatformsSet = new Set([
    'desktop_web',
    'desktop_web_messenger',
    'desktop_app_messenger',
    'mobile_web',
    'mobile_android',
    'mobile_android_messenger',
    'mobile_iphone',
    'mobile_iphone_messenger',
    'mobile_ipad'
]);
const parseURLSearchParamsForGetLaunchParams = (searchParams)=>{
    const launchParams = {};
    try {
        const parsedSearchParams = new URLSearchParams(searchParams);
        const convertToggleStateFromStringToNumber = (value)=>{
            switch(value){
                case '0':
                    return 0;
                case '1':
                    return 1;
                default:
                    return;
            }
        };
        parsedSearchParams.forEach((value, query)=>{
            switch(query){
                case 'vk_ts':
                case 'vk_is_recommended':
                case 'vk_profile_id':
                case 'vk_has_profile_button':
                case 'vk_testing_group_id':
                case 'vk_user_id':
                case 'vk_app_id':
                case 'vk_group_id':
                    launchParams[query] = Number(value);
                    break;
                case 'sign':
                case 'vk_chat_id':
                case 'vk_ref':
                case 'vk_access_token_settings':
                    launchParams[query] = value;
                    break;
                case 'odr_enabled':
                    launchParams.odr_enabled = '1' === value ? 1 : void 0;
                    break;
                case 'vk_is_app_user':
                case 'vk_are_notifications_enabled':
                case 'vk_is_favorite':
                    launchParams[query] = convertToggleStateFromStringToNumber(value);
                    break;
                case 'vk_language':
                    {
                        const validateVKLanguage = (value)=>getLaunchParamsResponseLanguagesSet.has(value);
                        launchParams.vk_language = validateVKLanguage(value) ? value : void 0;
                        break;
                    }
                case 'vk_viewer_group_role':
                    {
                        const validateVKViewerGroupRole = (value)=>getLaunchParamsResponseGroupRoleSet.has(value);
                        launchParams.vk_viewer_group_role = validateVKViewerGroupRole(value) ? value : void 0;
                        break;
                    }
                case 'vk_platform':
                    {
                        const validateVKPlatform = (value)=>getLaunchParamsResponsePlatformsSet.has(value);
                        launchParams.vk_platform = validateVKPlatform(value) ? value : void 0;
                        break;
                    }
            }
        });
    } catch (e) {
        console.warn(e);
    }
    return launchParams;
};
const src_bridge = createVKBridge(package_namespaceObject.rE);
export default src_bridge;
export { applyMiddleware, parseURLSearchParamsForGetLaunchParams };

//# sourceMappingURL=vk-bridge-3.0.2.js.map
