var fs = require('fs');
var MSGREADER = require("./lib/msg.reader");
var renderer = require("./lib/render");

if (process.argv === null || process.argv.length < 3){
    console.log("usage:: msgview filename.msg");
    return;
}

var msgFile = process.argv[2];

if(!fs.existsSync(msgFile)){
    console.log("could not find file " + msgFile);
    return;
}

var arrayBuffer = fs.readFileSync(msgFile);

var mr = new MSGREADER(arrayBuffer);

var output = renderer.render(mr,'html');

console.log(output);



//console.dir(fileData);

