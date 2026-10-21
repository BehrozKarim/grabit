import { createHostedHandler } from '../server/hosted-backend.js'

export default {
  fetch(request: Request) {
    return createHostedHandler({
      GRABIT_BACKEND_URL: process.env.GRABIT_BACKEND_URL,
      GRABIT_BACKEND_API_KEY: process.env.GRABIT_BACKEND_API_KEY,
    })(request)
  },
}
