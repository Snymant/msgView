var fs = require('fs');

class render{
    

    get tmpfolder(){
        return "/var/tmp/";
    }


    static render(msgReader,format){
        this.msgReader = msgReader;
        let msgData = msgReader.getFileData();
        if(format === "html"){
            return this.renderHtml(msgData);
        }
        throw new Error("usopprted format " + format);
    }

    static renderHtml(msgData){
        
        let h = 0;
        let html = [];
        html[h++] = "<html><body>"

        html[h++] = "<div>"
        html[h++] = "<label>SUBJECT: " + msgData.subject +"</label>";        
        html[h++] = "</div>"

        html[h++] = "<div>"
        html[h++] = "<label>SENDER: " + msgData.senderName +"</label>";        
        html[h++] = "</div>"

        html[h++] = "<div>"
        html[h++] = "<div>"
        html[h++] = "<label>Attachments count: " + msgData.attachments.length +"</label>";        
        html[h++] = "</div>"
        for(let a=0; a< msgData.attachments.length; a++){            
            // var ba = new Buffer(this.msgReader.getAttachment(a).content).toString("base64");
            html[h++] = "<div>"
            html[h++] = "<a href='"
            html[h++] = this.saveToDisk(a);
            html[h++] = "' target='_blank'>"
            /*
            html[h++] = "href='data:application/octet-stream;base64," 
            html[h++] = ba;
            html[h++] = "' download>" 
            */
            html[h++] = msgData.attachments[a].fileName +"</a>";        
            html[h++] = "</div>"
        }
        html[h++] = "</div>"

        html[h++] = "<div>"
        html[h++] = "<p>" + msgData.body.replace(/[\r]/g, "").replace(/[\n]/g, "<br>") +"</p>";        
        html[h++] = "</div>"

        html[h++] = "</body></html>"
        
        //console.log(msgData);

        return html.join('');

        
    }

    //save attachment
    static saveToDisk(attNo){    
        let aData = this.msgReader.getAttachment(attNo);    
        let buffer = new Buffer(aData.content);        
        let savedFileName = "/var/tmp/"+aData.fileName;
        fs.writeFileSync(savedFileName,buffer);        
        return savedFileName;
    }

}

module.exports = render;