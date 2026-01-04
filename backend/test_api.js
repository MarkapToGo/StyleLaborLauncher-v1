const axios = require('axios');

async function test() {
    try {
        const res = await axios.get('http://localhost:3000/api/modpacks');
        console.log("Status:", res.status);
        console.log("Headers:", res.headers);
        console.log("Data:", JSON.stringify(res.data, null, 2));
        console.log("Type of Data:", typeof res.data);
    } catch (e) {
        console.error("Error:", e.message);
        if(e.response) {
            console.log("Response data:", e.response.data);
        }
    }
}

test();
